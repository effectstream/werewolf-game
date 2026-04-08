import nacl from "tweetnacl";
import type { WalletClient } from "viem";
import { evmWallet } from "../services/evmWallet";
import { midnightWallet } from "../services/midnightWallet";
import { proxyMidnightWallet } from "../services/proxyMidnightWallet";
import { type GameInfo, getGameState } from "../services/lobbyContract";
import { BatcherService } from "../services/batcherService";
import { gameState, type PlayerBundle } from "../state/gameState";
import {
  fetchBundle,
  fetchLobbyStatus,
  fetchOpenLobby,
  fetchPlayerGames,
  type LobbyStatusResponse,
} from "../services/lobbyApi";
import {
  decodeGamePhrase,
  encodeGameId,
  isGamePhrase,
} from "../services/werewolfIdCodec";
import {
  clearSession,
  getAllSessions,
  hexToBytes,
  loadSession,
  saveSession,
  type StoredSession,
} from "../services/sessionStore";
import { deriveNicknameFromMidnightAddress } from "../services/nicknameGenerator";
import {
  type AvatarSelection,
  decodeAppearance,
  encodeAppearance,
  HAIR_COLORS,
  HAIR_STYLE_LABELS,
  HAIR_STYLES,
  hasAvatarSelection,
  loadAvatarSelection,
  randomAvatarSelection,
  saveAvatarSelection,
  SHIRT_COLORS,
  SKIN_TONES,
} from "../avatarAppearance";
import { AvatarPreview } from "../ui/AvatarPreview";
import { toastManager } from "../ui/ToastManager";

const MIDNIGHT_NETWORK_ID =
  (import.meta.env.VITE_MIDNIGHT_NETWORK_ID as string | undefined) ??
    "undeployed";
const LOBBY_POLL_INTERVAL_MS = 4000;

type MidnightConnectChoice = "lace" | "local" | "cancel";
const GAME_INFO_POLL_INTERVAL_MS = 10000;

function formatRemainingTime(seconds: number): string {
  if (seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m < 60) return `${m}:${s.toString().padStart(2, "0")}`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Derives a deterministic Ed25519 signing keypair for a given game from the
 * player's EVM wallet. The local wallet signs the fixed message
 * `"werewolf:{gameId}"` (EIP-191 personal_sign semantics). The resulting
 * ECDSA signature bytes
 * are SHA-256 hashed to produce a 32-byte seed for `nacl.sign.keyPair.fromSeed`.
 *
 * Because EVM ECDSA uses RFC 6979 deterministic k-generation, the same wallet
 * always produces the same signature for the same message, making the derived
 * Ed25519 keypair fully recoverable on any device that holds the EVM private key.
 */
async function deriveGameKeypair(
  _evmAddress: `0x${string}`,
  gameId: number,
  walletClient: WalletClient,
): Promise<nacl.SignKeyPair> {
  const evmSig = await walletClient.signMessage({
    message: `werewolf:${gameId}`,
  });
  // evmSig is 0x-prefixed 130-char hex (65 bytes). Strip the 0x prefix.
  const sigBytes = hexToBytes(evmSig.slice(2));
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(sigBytes),
  );
  return nacl.sign.keyPair.fromSeed(new Uint8Array(hashBuffer));
}

export class LobbyScreen {
  onJoined: (
    gameId: number,
    gameStarted: boolean,
    publicKeyHex: string,
    nickname: string,
    appearanceCode: number,
  ) => void = () => {};
  onLeaderboardClick: () => void = () => {};

  private static readonly DISCOVER_POLL_MS = 3_000; // ms between /api/open_lobby retries
  private static readonly DISCOVER_TIMEOUT_MS = 300_000; // give up after 5 minutes

  private container: HTMLDivElement;
  private statusEl!: HTMLParagraphElement;
  private startHintEl!: HTMLParagraphElement;
  private walletBtn!: HTMLButtonElement;
  private evmAddressEl!: HTMLSpanElement;
  private midnightAddressEl!: HTMLSpanElement;
  private activeGamesSection!: HTMLDivElement;
  private gameSection!: HTMLDivElement;
  private gameIdInput!: HTMLInputElement;
  private nicknameInfoEl!: HTMLDivElement;
  private nicknameValueEl!: HTMLElement;
  private findBtn!: HTMLButtonElement;
  private gameInfoEl!: HTMLDivElement;
  private avatarSection!: HTMLDivElement;
  private avatarPreviewEl!: HTMLDivElement;
  private avatarShuffleBtn!: HTMLButtonElement;
  private joinBtn!: HTMLButtonElement;
  private laceModalBackdrop!: HTMLDivElement;
  private midnightChoiceBackdrop!: HTMLDivElement;
  private midnightChoiceLaceBtn!: HTMLButtonElement;
  private midnightChoiceLeadEl!: HTMLParagraphElement;
  private proxyBadgeEl!: HTMLSpanElement;
  private associateSection!: HTMLDivElement;

  private _midnightChoiceResolve:
    | ((choice: MidnightConnectChoice) => void)
    | null = null;

  private _usingProxy: boolean = false;
  private currentGame: GameInfo | null = null;
  private derivedNickname: string | null = null;
  /**
   * Game ID of the rejoin flow currently in progress, or null if none.
   * Guards against concurrent rejoins: auto-detection in `handleFindGame`
   * and the "Your Active Games" Rejoin tile can fire at the same time after
   * a page reload. Without this flag the player would see two wallet prompts
   * and two polling loops.
   */
  private _rejoinInProgress: number | null = null;
  private lobbyPollTimer: ReturnType<typeof setInterval> | null = null;
  private gameInfoPollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly _initialAvatarSelection: AvatarSelection =
    hasAvatarSelection() ? loadAvatarSelection() : randomAvatarSelection();
  private readonly avatarPreview = new AvatarPreview(
    this._initialAvatarSelection,
  );
  private avatarSelection: AvatarSelection = this._initialAvatarSelection;

  constructor() {
    this.container = document.createElement("div");
    this.container.className = "lobby-screen";
    this.container.innerHTML = `
      <div class="lobby-card">
        <h1 class="lobby-title">Werewolf</h1>
        <p class="lobby-subtitle">Midnight &times; EVM</p>
        <div class="lobby-title-actions">
          <button id="lobbyLeaderboardBtn" class="ui-btn lobby-btn lobby-btn--secondary">🏆 Leaderboard</button>
        </div>

        <section class="lobby-wallet-section">
          <button id="lobbyWalletBtn" class="ui-btn lobby-btn">Start Now</button>
          <div id="lobbyWalletInfo" class="lobby-wallet-info" hidden>
            <span id="lobbyEvmAddress" class="lobby-address lobby-address--evm"></span>
            <br />
            <span id="lobbyMidnightAddress" class="lobby-address lobby-address--midnight"></span>
            <span id="lobbyProxyBadge" class="lobby-proxy-badge" hidden>Proxy Wallet</span>
          </div>
          <div id="lobbyAssociateSection" class="lobby-associate-section" hidden>
            <p class="lobby-associate-copy">
              You are using a <strong>proxy Midnight wallet</strong>. Install Lace and click
              "Associate Wallets" to migrate your leaderboard points to your real wallet.
            </p>
            <button type="button" id="lobbyAssociateBtn" class="ui-btn lobby-btn">Associate with Lace Wallet</button>
          </div>
        </section>

        <section id="lobbyActiveGames" class="lobby-active-games" hidden></section>

        <section id="lobbyGameSection" class="lobby-game-section" hidden>
          <!-- Find Game bar + optional hint are kept in the DOM (referenced by
               handleFindGame / setLoading) but hidden from the user.
               Inline style is required because .lobby-row has an explicit
               display rule that would otherwise override the [hidden] UA style. -->
          <div class="lobby-row" style="display:none">
            <input
              id="lobbyGameIdInput"
              class="lobby-input"
              type="text"
              placeholder="Game ID or 4-word phrase"
              title="Optional — enter a Game ID or 4-word phrase to join a specific game. Leave blank to join any open lobby."
            />
            <button
              id="lobbyFindBtn"
              class="ui-btn lobby-btn"
              title="Optional — enter a Game ID or 4-word phrase to join a specific game. Leave blank to join any open lobby."
            >Find Game</button>
          </div>
          <p class="lobby-find-hint" style="display:none">Optional — leave blank to join any open game.</p>
          <div id="lobbyGameInfo" class="lobby-game-info" hidden></div>
          <div
            id="lobbyNicknameInfo"
            class="lobby-game-info"
            hidden
            title="Automatically generated from your wallet address."
          >
            <div class="lobby-game-row"><span class="has-tooltip" data-tooltip="Automatically generated from your wallet address." title="Automatically generated from your wallet address.">Nickname</span><strong id="lobbyNicknameValue"></strong></div>
            <p class="lobby-nickname-hint">Auto-generated from your wallet address.</p>
          </div>
          <button id="lobbyJoinBtn" class="ui-btn lobby-btn lobby-btn--primary" hidden>Join Game</button>
        </section>

        <p id="lobbyStatus" class="lobby-status"></p>
        <p id="lobbyStartHint" class="lobby-start-hint" hidden>Starts instantly with 16 players. With 6–15 players, the game auto-starts every 30 minutes.</p>
        <div class="lobby-rules-row">
          <button type="button" id="lobbyRulesBtn" class="ui-btn lobby-btn lobby-btn--secondary lobby-rules-btn">📖 How to Play</button>
        </div>
      </div>
      <div id="lobbyAvatarSection" class="lobby-avatar-card" hidden>
        <div class="lobby-avatar-panel">
          <div>
            <h3 class="lobby-section-title">Character Preview</h3>
            <p class="lobby-avatar-copy">Choose how your villager looks before joining the lobby.</p>
          </div>
          <div id="lobbyAvatarPreview" class="lobby-avatar-preview" aria-label="Avatar preview"></div>
        </div>
        <div class="lobby-avatar-controls">
          <div class="lobby-avatar-group">
            <span class="lobby-avatar-label">Skin Tone</span>
            <div class="lobby-swatch-row" data-avatar-group="skinTone">
              ${
      SKIN_TONES.map((color, index) => `
                <button
                  type="button"
                  class="lobby-swatch-btn"
                  data-avatar-option="skinTone:${index}"
                  aria-label="Skin tone ${index + 1}"
                  style="--swatch-color: #${
        color.toString(16).padStart(6, "0")
      }"
                ></button>
              `).join("")
    }
            </div>
          </div>
          <div class="lobby-avatar-group">
            <span class="lobby-avatar-label">Shirt Color</span>
            <div class="lobby-swatch-row" data-avatar-group="shirtColor">
              ${
      SHIRT_COLORS.map((color, index) => `
                <button
                  type="button"
                  class="lobby-swatch-btn"
                  data-avatar-option="shirtColor:${index}"
                  aria-label="Shirt color ${index + 1}"
                  style="--swatch-color: #${
        color.toString(16).padStart(6, "0")
      }"
                ></button>
              `).join("")
    }
            </div>
          </div>
          <div class="lobby-avatar-group">
            <span class="lobby-avatar-label">Hair Color</span>
            <div class="lobby-swatch-row" data-avatar-group="hairColor">
              ${
      HAIR_COLORS.map((color, index) => `
                <button
                  type="button"
                  class="lobby-swatch-btn"
                  data-avatar-option="hairColor:${index}"
                  aria-label="Hair color ${index + 1}"
                  style="--swatch-color: #${
        color.toString(16).padStart(6, "0")
      }"
                ></button>
              `).join("")
    }
            </div>
          </div>
          <div class="lobby-avatar-group">
            <span class="lobby-avatar-label">Hair Style</span>
            <div class="lobby-style-row" data-avatar-group="hairStyle">
              ${
      HAIR_STYLES.map((style, index) => `
                <button
                  type="button"
                  class="lobby-style-btn"
                  data-avatar-option="hairStyle:${index}"
                  aria-label="${HAIR_STYLE_LABELS[style]}"
                >${HAIR_STYLE_LABELS[style]}</button>
              `).join("")
    }
            </div>
          </div>
          <button type="button" id="lobbyAvatarShuffleBtn" class="ui-btn lobby-btn lobby-btn--secondary lobby-avatar-shuffle-btn">🎲 Shuffle</button>
        </div>
      </div>

    <div id="midnightChoiceBackdrop" class="lace-install-backdrop midnight-choice-backdrop" hidden>
      <div class="lace-install-modal midnight-choice-modal" role="dialog" aria-modal="true" aria-labelledby="midnightChoiceTitle">
        <div class="lace-install-icon">🌙</div>
        <h2 id="midnightChoiceTitle" class="lace-install-title">Midnight wallet</h2>
        <p id="midnightChoiceLead" class="lace-install-body"></p>
        <div class="midnight-choice-actions">
          <div class="midnight-choice-actions-row">
            <button type="button" id="midnightChoiceLaceBtn" class="ui-btn lace-install-cta">Browser wallet (Lace)</button>
            <button type="button" id="midnightChoiceLocalBtn" class="ui-btn lace-install-dismiss">Temporary Wallet</button>
          </div>
          <button type="button" id="midnightChoiceCancelBtn" class="ui-btn midnight-choice-cancel">Cancel</button>
        </div>
      </div>
    </div>

    <div id="laceInstallBackdrop" class="lace-install-backdrop" hidden>
      <div class="lace-install-modal" role="dialog" aria-modal="true" aria-labelledby="laceInstallTitle">
        <div class="lace-install-icon">🔐</div>
        <h2 id="laceInstallTitle" class="lace-install-title">You're playing with a temporary wallet</h2>
        <p class="lace-install-body">
          Your <strong>Midnight address</strong> has been derived automatically
          from a generated proxy EVM wallet that lives on this browser. Your leaderboard points are safe.
        </p>
        <p class="lace-install-body">
          Install <strong>Lace</strong> later to link your real Midnight wallet
          and keep all rewards.
        </p>
        <div class="lace-install-actions">
          <button type="button" id="laceInstallClose" class="ui-btn lace-install-cta">Got it, let's play!</button>
          <a
            href="https://chromewebstore.google.com/detail/lace/gafhhkghbfjjkeiendhlofajokpaflmk"
            target="_blank"
            rel="noopener noreferrer"
            class="ui-btn lace-install-dismiss"
          >Install Lace</a>
        </div>
      </div>
    </div>

    <div id="rulesModalBackdrop" class="rules-modal-backdrop" hidden>
      <div class="rules-modal" role="dialog" aria-modal="true" aria-labelledby="rulesModalTitle">
        <button type="button" id="rulesModalCloseBtn" class="rules-modal-close" aria-label="Close">✕</button>
        <h2 id="rulesModalTitle" class="rules-modal-title">How to Play</h2>

        <section class="rules-section">
          <h3 class="rules-section-heading">🎭 The Setup</h3>
          <p class="rules-body">6–16 players join a lobby. Each player is secretly assigned a role. The village must identify and eliminate the werewolves before they're outnumbered.</p>
        </section>

        <section class="rules-section">
          <h3 class="rules-section-heading">👥 Roles</h3>
          <div class="rules-role-grid">
            <div class="rules-role-card">
              <span class="rules-role-icon">🧑‍🌾</span>
              <strong class="rules-role-name">Villager</strong>
              <p class="rules-role-desc">No special ability. Vote wisely each day to eliminate werewolves.</p>
            </div>
            <div class="rules-role-card">
              <span class="rules-role-icon">🐺</span>
              <strong class="rules-role-name">Werewolf</strong>
              <p class="rules-role-desc">Each night, secretly vote to eliminate a villager. Blend in by day.</p>
            </div>
            <div class="rules-role-card" hidden>
              <span class="rules-role-icon">🔮</span>
              <strong class="rules-role-name">Seer</strong>
              <p class="rules-role-desc">Each night, learn the true role of one player. Guide the village with your knowledge.</p>
            </div>
            <div class="rules-role-card" hidden>
              <span class="rules-role-icon">💊</span>
              <strong class="rules-role-name">Doctor</strong>
              <p class="rules-role-desc">Each night, protect one player from elimination. You can protect yourself.</p>
            </div>
          </div>
        </section>

        <section class="rules-section">
          <h3 class="rules-section-heading">☀️ Day Phase</h3>
          <p class="rules-body">All players discuss and vote to eliminate a suspect. The player with the most votes is eliminated and their role is revealed.</p>
        </section>

        <section class="rules-section">
          <h3 class="rules-section-heading">🌙 Night Phase</h3>
          <p class="rules-body">Werewolves secretly vote to eliminate a villager. The Seer investigates one player. The Doctor protects one player. Results are revealed at dawn.</p>
        </section>

        <section class="rules-section">
          <h3 class="rules-section-heading">🏆 Win Conditions</h3>
          <div class="rules-win-row">
            <div class="rules-win-card rules-win-village">
              <span class="rules-win-icon">🧑‍🌾</span>
              <strong>Village wins</strong>
              <p>when all werewolves are eliminated.</p>
            </div>
            <div class="rules-win-card rules-win-wolves">
              <span class="rules-win-icon">🐺</span>
              <strong>Werewolves win</strong>
              <p>when they equal or outnumber the villagers.</p>
            </div>
          </div>
        </section>

        <section class="rules-section">
          <h3 class="rules-section-heading">🗂️ Role Guesser</h3>
          <p class="rules-body">Click any 3D player model in the scene to tag your private guess about their role. This is your personal notepad — only you can see it.</p>
        </section>

        <button type="button" id="rulesModalCloseBtnBottom" class="ui-btn lobby-btn lobby-btn--secondary" style="margin-top:8px;">Got it!</button>
      </div>
    </div>
    `;

    this.walletBtn = this.container.querySelector<HTMLButtonElement>(
      "#lobbyWalletBtn",
    )!;
    this.evmAddressEl = this.container.querySelector<HTMLSpanElement>(
      "#lobbyEvmAddress",
    )!;
    this.midnightAddressEl = this.container.querySelector<HTMLSpanElement>(
      "#lobbyMidnightAddress",
    )!;
    this.activeGamesSection = this.container.querySelector<HTMLDivElement>(
      "#lobbyActiveGames",
    )!;
    this.gameSection = this.container.querySelector<HTMLDivElement>(
      "#lobbyGameSection",
    )!;
    this.gameIdInput = this.container.querySelector<HTMLInputElement>(
      "#lobbyGameIdInput",
    )!;
    this.nicknameInfoEl = this.container.querySelector<HTMLDivElement>(
      "#lobbyNicknameInfo",
    )!;
    this.nicknameValueEl = this.container.querySelector<HTMLElement>(
      "#lobbyNicknameValue",
    )!;
    this.findBtn = this.container.querySelector<HTMLButtonElement>(
      "#lobbyFindBtn",
    )!;
    this.gameInfoEl = this.container.querySelector<HTMLDivElement>(
      "#lobbyGameInfo",
    )!;
    this.avatarSection = this.container.querySelector<HTMLDivElement>(
      "#lobbyAvatarSection",
    )!;
    this.avatarPreviewEl = this.container.querySelector<HTMLDivElement>(
      "#lobbyAvatarPreview",
    )!;
    this.avatarShuffleBtn = this.container.querySelector<HTMLButtonElement>(
      "#lobbyAvatarShuffleBtn",
    )!;
    this.joinBtn = this.container.querySelector<HTMLButtonElement>(
      "#lobbyJoinBtn",
    )!;
    this.statusEl = this.container.querySelector<HTMLParagraphElement>(
      "#lobbyStatus",
    )!;
    this.startHintEl = this.container.querySelector<HTMLParagraphElement>(
      "#lobbyStartHint",
    )!;

    this.midnightChoiceBackdrop = this.container.querySelector<HTMLDivElement>(
      "#midnightChoiceBackdrop",
    )!;
    this.midnightChoiceLaceBtn = this.container.querySelector<
      HTMLButtonElement
    >(
      "#midnightChoiceLaceBtn",
    )!;
    const midnightChoiceLocalBtn = this.container.querySelector<
      HTMLButtonElement
    >("#midnightChoiceLocalBtn")!;
    const midnightChoiceCancelBtn = this.container.querySelector<
      HTMLButtonElement
    >("#midnightChoiceCancelBtn")!;
    this.midnightChoiceLeadEl = this.container.querySelector<
      HTMLParagraphElement
    >(
      "#midnightChoiceLead",
    )!;
    this.midnightChoiceLaceBtn.addEventListener(
      "click",
      () => this.finishMidnightChoiceModal("lace"),
    );
    midnightChoiceLocalBtn.addEventListener(
      "click",
      () => this.finishMidnightChoiceModal("local"),
    );
    midnightChoiceCancelBtn.addEventListener(
      "click",
      () => this.finishMidnightChoiceModal("cancel"),
    );
    this.midnightChoiceBackdrop.addEventListener("click", (e) => {
      if (e.target === this.midnightChoiceBackdrop) {
        this.finishMidnightChoiceModal("cancel");
      }
    });

    this.laceModalBackdrop = this.container.querySelector<HTMLDivElement>(
      "#laceInstallBackdrop",
    )!;
    this.container.querySelector<HTMLButtonElement>("#laceInstallClose")!
      .addEventListener("click", () => {
        this.laceModalBackdrop.hidden = true;
      });
    this.laceModalBackdrop.addEventListener("click", (e) => {
      if (e.target === this.laceModalBackdrop) {
        this.laceModalBackdrop.hidden = true;
      }
    });

    this.proxyBadgeEl = this.container.querySelector<HTMLSpanElement>(
      "#lobbyProxyBadge",
    )!;
    this.associateSection = this.container.querySelector<HTMLDivElement>(
      "#lobbyAssociateSection",
    )!;
    this.container.querySelector<HTMLButtonElement>("#lobbyAssociateBtn")!
      .addEventListener("click", () => this.handleAssociateWallets());

    this.walletBtn.addEventListener("click", () => this.handleConnectWallet());
    this.findBtn.addEventListener("click", () => this.handleFindGame());
    this.joinBtn.addEventListener("click", () => this.handleJoinGame());
    this.container.querySelector<HTMLButtonElement>("#lobbyLeaderboardBtn")!
      .addEventListener("click", () => this.onLeaderboardClick());

    const rulesBackdrop = this.container.querySelector<HTMLDivElement>(
      "#rulesModalBackdrop",
    )!;
    const openRules = () => {
      rulesBackdrop.hidden = false;
    };
    const closeRules = () => {
      rulesBackdrop.hidden = true;
    };
    this.container.querySelector<HTMLButtonElement>("#lobbyRulesBtn")!
      .addEventListener("click", openRules);
    this.container.querySelector<HTMLButtonElement>("#rulesModalCloseBtn")!
      .addEventListener("click", closeRules);
    this.container.querySelector<HTMLButtonElement>(
      "#rulesModalCloseBtnBottom",
    )!.addEventListener("click", closeRules);
    rulesBackdrop.addEventListener("click", (e) => {
      if (e.target === rulesBackdrop) closeRules();
    });

    this.avatarPreview.mount(this.avatarPreviewEl);
    this.bindAvatarControls();
    this.syncAvatarSelection();
  }

  show(): void {
    this.resetLobbyState();
    const app = document.querySelector<HTMLDivElement>("#app")!;
    app.innerHTML = "";
    app.appendChild(this.container);

    // Re-mount the avatar preview (may have been stopped when hide() was called).
    this.avatarPreview.mount(this.avatarPreviewEl);

    // If wallet is already connected (e.g. returning from a finished game), refresh lobby state.
    const evmAddress = evmWallet.getAddress();
    if (evmAddress) {
      this.setStatus("Searching for open lobby…");
      void this.autoDiscoverLobby();
      void this.loadActiveGames(evmAddress);
    }
  }

  hide(): void {
    if (this.lobbyPollTimer) {
      clearInterval(this.lobbyPollTimer);
      this.lobbyPollTimer = null;
    }
    if (this.gameInfoPollTimer) {
      clearInterval(this.gameInfoPollTimer);
      this.gameInfoPollTimer = null;
    }
    this.finishMidnightChoiceModal("cancel");
    // Pause the render loop without disposing the WebGL renderer so it can
    // be restarted via mount() when the lobby is shown again.
    this.avatarPreview.stop();
    this.container.remove();
  }

  private setStatus(msg: string, isError = false): void {
    this.statusEl.textContent = msg;
    this.statusEl.classList.toggle("lobby-status--error", isError);
  }

  private resetLobbyState(): void {
    this.gameInfoEl.hidden = true;
    this.avatarSection.hidden = true;
    this.avatarSection.classList.remove("lobby-avatar-card--locked");
    this.startHintEl.hidden = true;
    this.joinBtn.hidden = true;
    this.currentGame = null;
    this.setStatus("");

    // Reset any lingering loading states on the action buttons so they
    // are not left disabled/spinning when the lobby is shown again.
    this.setLoading(this.findBtn, false, "Find Game");
    this.setLoading(this.joinBtn, false, "Join Game");

    // Stop any existing game info polling
    if (this.gameInfoPollTimer) {
      clearInterval(this.gameInfoPollTimer);
      this.gameInfoPollTimer = null;
    }

    // Clear the game ID input
    this.gameIdInput.value = "";
  }

  private setLoading(
    btn: HTMLButtonElement,
    loading: boolean,
    label: string,
  ): void {
    btn.disabled = loading;
    btn.textContent = loading ? "..." : label;
  }

  private finishMidnightChoiceModal(choice: MidnightConnectChoice): void {
    if (!this._midnightChoiceResolve) return;
    this.midnightChoiceBackdrop.hidden = true;
    const resolve = this._midnightChoiceResolve;
    this._midnightChoiceResolve = null;
    resolve(choice);
  }

  private openMidnightChoiceModal(): Promise<MidnightConnectChoice> {
    return new Promise((resolve) => {
      this._midnightChoiceResolve = resolve;
      const laceAvailable = midnightWallet.isAvailable();
      this.midnightChoiceLaceBtn.hidden = !laceAvailable;
      if (laceAvailable) {
        this.midnightChoiceLeadEl.textContent =
          "A Midnight-compatible wallet is available in this browser. Connect through your browser wallet, or use a local Midnight wallet derived from your EVM account.";
      } else {
        this.midnightChoiceLeadEl.textContent =
          "No Midnight browser wallet was detected. Continue with a local Midnight wallet derived from your EVM account, or install Lace and refresh this page.";
      }
      this.midnightChoiceBackdrop.hidden = false;
    });
  }

  private bindAvatarControls(): void {
    const swatches = this.container.querySelectorAll<HTMLButtonElement>(
      "[data-avatar-option]",
    );
    swatches.forEach((button) => {
      button.addEventListener("click", () => {
        const rawOption = button.dataset.avatarOption;
        if (!rawOption) return;

        const [group, indexValue] = rawOption.split(":");
        const index = Number(indexValue);
        if (!Number.isInteger(index)) return;

        if (group === "skinTone") {
          this.avatarSelection.skinTone = index;
        } else if (group === "shirtColor") {
          this.avatarSelection.shirtColor = index;
        } else if (group === "hairColor") {
          this.avatarSelection.hairColor = index;
        } else if (group === "hairStyle") {
          this.avatarSelection.hairStyle = index;
        }

        saveAvatarSelection(this.avatarSelection);
        this.syncAvatarSelection();
      });
    });

    this.avatarShuffleBtn.addEventListener("click", () => {
      this.avatarSelection = randomAvatarSelection();
      saveAvatarSelection(this.avatarSelection);
      this.syncAvatarSelection();
    });
  }

  private syncAvatarSelection(): void {
    const encoded = encodeAppearance(this.avatarSelection);
    this.avatarPreview.setSelection(this.avatarSelection);

    const swatches = this.container.querySelectorAll<HTMLButtonElement>(
      "[data-avatar-option]",
    );
    swatches.forEach((button) => {
      const rawOption = button.dataset.avatarOption;
      if (!rawOption) return;

      const [group, indexValue] = rawOption.split(":");
      const index = Number(indexValue);
      const isSelected =
        (group === "skinTone" && this.avatarSelection.skinTone === index) ||
        (group === "shirtColor" && this.avatarSelection.shirtColor === index) ||
        (group === "hairColor" && this.avatarSelection.hairColor === index) ||
        (group === "hairStyle" && this.avatarSelection.hairStyle === index);

      button.classList.toggle(
        "lobby-swatch-btn--selected",
        group !== "hairStyle" && isSelected,
      );
      button.classList.toggle(
        "lobby-style-btn--selected",
        group === "hairStyle" && isSelected,
      );
      button.setAttribute("aria-pressed", String(isSelected));
    });

    this.avatarPreviewEl.dataset.appearanceCode = String(encoded);
  }

  /**
   * Connects both the locally-managed EVM wallet and the
   * Midnight wallet (Lace browser extension). Both are required — if either
   * fails the flow stops with an error.
   */
  private async handleConnectWallet(): Promise<void> {
    this.setLoading(this.walletBtn, true, "Connect Wallet");
    this.setStatus("Connecting EVM wallet…");

    // ── 1. EVM wallet ─────────────────────────────────────────────────────────
    let evmAddress: `0x${string}`;
    try {
      const evmState = await evmWallet.connect();
      evmAddress = evmState.address!;
      this.evmAddressEl.textContent = `EVM: ${evmAddress}`;
      console.log("[LobbyScreen] EVM wallet connected:", evmAddress);
    } catch (err) {
      this.setLoading(this.walletBtn, false, "Connect Wallet");
      this.setStatus(
        `EVM wallet connection failed: ${(err as Error).message}`,
        true,
      );
      return;
    }

    this.setLoading(this.walletBtn, false, "Connect Wallet");
    this.setStatus("");

    const choice = await this.openMidnightChoiceModal();
    if (choice === "cancel") {
      this.setStatus("");
      return;
    }

    this.setLoading(this.walletBtn, true, "Connect Wallet");

    // ── 2. Midnight wallet (user-chosen: Lace or local proxy) ─────────────────
    let shielded: string;

    if (choice === "lace") {
      this.setStatus("Connecting Midnight wallet…");
      try {
        const midnightState = await midnightWallet.connect(MIDNIGHT_NETWORK_ID);
        shielded = midnightState.shieldedAddress!;
        this._usingProxy = false;
        console.log("[LobbyScreen] Midnight wallet connected:", shielded);
      } catch (laceErr) {
        this.setLoading(this.walletBtn, false, "Connect Wallet");
        this.derivedNickname = null;
        this.nicknameValueEl.textContent = "";
        this.nicknameInfoEl.hidden = true;
        this.setStatus(
          `Midnight wallet connection failed: ${(laceErr as Error).message}`,
          true,
        );
        return;
      }
    } else {
      this.setStatus("Initialising local Midnight wallet…");
      try {
        const walletClient = evmWallet.getWalletClient()!;
        const proxyState = await proxyMidnightWallet.initialize(
          walletClient,
          evmAddress,
          MIDNIGHT_NETWORK_ID,
        );
        midnightWallet.activateProxy(
          proxyState,
          proxyMidnightWallet.asConnectedAPI(),
        );
        this._usingProxy = true;
        shielded = proxyState.shieldedAddress;
        console.log(
          "[LobbyScreen] Proxy wallet activated:",
          shielded.slice(0, 16) + "…",
        );
        this.laceModalBackdrop.hidden = false;
      } catch (proxyErr) {
        this.setLoading(this.walletBtn, false, "Connect Wallet");
        this.setStatus(
          `Local wallet initialisation failed: ${(proxyErr as Error).message}`,
          true,
        );
        return;
      }
    }

    this.derivedNickname = deriveNicknameFromMidnightAddress(shielded);
    const displayAddr = shielded.length > 24
      ? `${shielded.slice(0, 12)}…${shielded.slice(-8)}`
      : shielded;
    this.midnightAddressEl.textContent = `Midnight: ${displayAddr}`;
    this.nicknameValueEl.textContent = this.derivedNickname;
    this.nicknameInfoEl.hidden = false;
    console.log("[LobbyScreen] Derived nickname:", this.derivedNickname);

    // ── 3. Reveal wallet info and game section ────────────────────────────────
    const walletInfo = this.container.querySelector<HTMLDivElement>(
      "#lobbyWalletInfo",
    )!;
    walletInfo.hidden = false;

    if (this._usingProxy) {
      this.proxyBadgeEl.hidden = false;
      this.associateSection.hidden = false;
      this.walletBtn.textContent = "Proxy Wallet Connected";
    } else {
      this.proxyBadgeEl.hidden = true;
      this.associateSection.hidden = true;
      this.walletBtn.textContent = "Wallets Connected";
    }
    this.walletBtn.disabled = true;
    this.gameSection.hidden = false;
    this.setStatus("Searching for open lobby…");
    void this.autoDiscoverLobby();
    void this.loadActiveGames(evmAddress);
  }

  private async autoDiscoverLobby(): Promise<void> {
    const deadline = Date.now() + LobbyScreen.DISCOVER_TIMEOUT_MS;
    let attempt = 0;
    while (Date.now() < deadline) {
      try {
        const open = await fetchOpenLobby();
        if (open) {
          this.gameIdInput.value = encodeGameId(open.gameId);
          await this.handleFindGame();
          return;
        }
      } catch {
        // transient network error — keep retrying
      }
      attempt++;
      this.setStatus(`Waiting for lobby… (${attempt})`);
      await new Promise<void>((r) =>
        setTimeout(r, LobbyScreen.DISCOVER_POLL_MS)
      );
    }
    this.setStatus("No open lobby found. Enter a Game ID to join.");
  }

  private async handleFindGame(): Promise<void> {
    const raw = this.gameIdInput.value.trim();
    console.log("[LobbyScreen] handleFindGame raw input:", raw);

    let gameId: number;
    if (isGamePhrase(raw)) {
      try {
        gameId = decodeGamePhrase(raw);
        console.log("[LobbyScreen] decoded game phrase to ID:", gameId);
      } catch (err) {
        console.error("[LobbyScreen] failed to decode phrase:", err);
        this.setStatus(`Invalid phrase: ${(err as Error).message}`, true);
        return;
      }
    } else {
      gameId = parseInt(raw, 10);
      if (isNaN(gameId) || gameId < 1) {
        this.setStatus("Enter a valid Game ID or 4-word phrase.", true);
        return;
      }
      console.log("[LobbyScreen] parsed numeric game ID:", gameId);
    }

    // ── Already-joined detection ──────────────────────────────────────────────
    // Tier 1: localStorage session exists → go straight to rejoin.
    const existingSession = loadSession(gameId);
    if (existingSession) {
      try {
        const status = await fetchLobbyStatus(gameId);
        if (!status.finished) {
          this.setLoading(this.findBtn, false, "Find Game");
          await this.handleRejoinGame(existingSession, status);
          return;
        }
      } catch {
        // non-critical — fall through to normal find flow
      }
    }

    // Tier 2: no localStorage but wallet connected → check backend membership.
    if (!existingSession) {
      const evmAddress = evmWallet.getAddress();
      if (evmAddress) {
        try {
          const { games } = await fetchPlayerGames(evmAddress);
          const record = games.find((g) => g.gameId === gameId && !g.finished);
          if (record) {
            const session: StoredSession = {
              gameId: record.gameId,
              publicKeyHex: record.publicKeyHex,
              nickname: record.nickname,
              appearanceCode: record.appearanceCode,
              evmAddress,
              bundle: null,
            };
            saveSession(session);
            const status = await fetchLobbyStatus(gameId);
            this.setLoading(this.findBtn, false, "Find Game");
            await this.handleRejoinGame(session, status);
            return;
          }
        } catch {
          // non-critical — fall through to normal find flow
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    this.setLoading(this.findBtn, true, "Find Game");
    this.resetLobbyState();

    try {
      console.log("[LobbyScreen] calling getGameState for gameId:", gameId);
      const game = await getGameState(gameId);
      this.currentGame = game;
      console.log("[LobbyScreen] getGameState result:", game);

      const stateLabel = game.state === "Open" ? "🟢 Open" : "🔴 Closed";
      let timerRow = "";
      if (game.state === "Open") {
        try {
          const lobbyStatus = await fetchLobbyStatus(game.id);
          if (
            lobbyStatus.timeoutBlock != null &&
            lobbyStatus.currentBlock != null
          ) {
            const remaining = Math.max(
              0,
              lobbyStatus.timeoutBlock - lobbyStatus.currentBlock,
            );
            timerRow =
              `<div class="lobby-game-row"><span class="has-tooltip" data-tooltip="The game starts immediately when 16 players join. With 6–15 players, it auto-starts every 30 minutes." title="The game starts immediately when 16 players join. With 6–15 players, it auto-starts every 30 minutes.">Starts in</span><strong class="lobby-countdown">${
                formatRemainingTime(remaining)
              }</strong></div>`;
          }
        } catch {
          // non-critical — just skip the timer
        }
      }
      this.gameInfoEl.innerHTML = `
        <div class="lobby-game-row"><span>Game Phrase</span><strong>${
        encodeGameId(game.id)
      }</strong></div>
        <div class="lobby-game-row"><span>Status</span><strong>${stateLabel}</strong></div>
        <div class="lobby-game-row"><span>Players</span><strong>${game.playerCount} / ${game.maxPlayers}</strong></div>
        ${timerRow}
      `;
      this.gameInfoEl.hidden = false;

      // Start polling for game info updates if game is open
      if (game.state === "Open") {
        this.startGameInfoPolling(game.id);
      }

      if (game.state === "Open" && game.playerCount < game.maxPlayers) {
        this.avatarSection.hidden = false;
        this.joinBtn.hidden = false;
        this.setStatus("Game is open. Customize your character and join.");
      } else if (game.state === "Closed") {
        this.avatarSection.hidden = true;
        this.setStatus("This game is closed.", true);
      } else {
        this.avatarSection.hidden = true;
        this.setStatus("This game is full.", true);
      }
    } catch (err) {
      console.error("[LobbyScreen] getGameState error:", err);
      this.setStatus(`Error: ${(err as Error).message}`, true);
    } finally {
      this.setLoading(this.findBtn, false, "Find Game");
    }
  }

  private startGameInfoPolling(gameId: number): void {
    // Stop any existing game info polling
    if (this.gameInfoPollTimer) {
      clearInterval(this.gameInfoPollTimer);
      this.gameInfoPollTimer = null;
    }

    const poll = async () => {
      try {
        const status = await fetchLobbyStatus(gameId);
        console.log("[LobbyScreen] game info poll status:", status);

        // Update the game info display with live data
        if (this.gameInfoEl && !this.gameInfoEl.hidden) {
          const stateLabel = status.state === "open"
            ? "🟢 Open"
            : status.state === "closed"
            ? "🔴 Closed"
            : "⏳ Bundles Ready";
          let timerRow = "";
          if (
            status.state === "open" &&
            status.timeoutBlock != null &&
            status.currentBlock != null
          ) {
            const remaining = Math.max(
              0,
              status.timeoutBlock - status.currentBlock,
            );
            timerRow =
              `<div class="lobby-game-row"><span class="has-tooltip" data-tooltip="The game starts immediately when 16 players join. With 6–15 players, it auto-starts every 30 minutes." title="The game starts immediately when 16 players join. With 6–15 players, it auto-starts every 30 minutes.">Starts in</span><strong class="lobby-countdown">${
                formatRemainingTime(remaining)
              }</strong></div>`;
          }
          this.gameInfoEl.innerHTML = `
            <div class="lobby-game-row"><span>Game Phrase</span><strong>${
            encodeGameId(gameId)
          }</strong></div>
            <div class="lobby-game-row"><span>Status</span><strong>${stateLabel}</strong></div>
            <div class="lobby-game-row"><span>Players</span><strong>${status.playerCount} / ${status.maxPlayers}</strong></div>
            ${timerRow}
          `;

          // Stop polling if game is closed or full
          if (status.state !== "open") {
            if (this.gameInfoPollTimer) {
              clearInterval(this.gameInfoPollTimer);
              this.gameInfoPollTimer = null;
            }
            // Player hasn't joined — game started without them. Find the next lobby.
            this.resetLobbyState();
            this.setStatus("Game has started. Searching for a new lobby…");
            void this.autoDiscoverLobby();
          } else if (status.playerCount >= status.maxPlayers) {
            this.avatarSection.hidden = true;
            this.joinBtn.hidden = true;
            this.setStatus("Game is full. Starting soon…");
          }
        }
      } catch (err) {
        console.error("[LobbyScreen] game info poll error:", err);
        // Don't stop polling on transient errors
      }
    };

    // Initial poll immediately, then every 10 seconds
    poll();
    this.gameInfoPollTimer = setInterval(poll, GAME_INFO_POLL_INTERVAL_MS);
  }

  private async handleJoinGame(): Promise<void> {
    const address = evmWallet.getAddress();
    const midnightAddress = midnightWallet.getShieldedAddress();

    console.log(
      "[LobbyScreen] handleJoinGame address:",
      address,
      "midnightAddress:",
      midnightAddress,
      "currentGame:",
      this.currentGame,
    );
    if (!address || !midnightAddress) {
      this.setStatus(
        "Wallets not connected. Please connect both EVM and Midnight wallets first.",
        true,
      );
      return;
    }
    if (!this.currentGame) {
      this.setStatus("No game selected. Please find a game first.", true);
      return;
    }

    const nickname = this.derivedNickname?.trim();
    if (!nickname) {
      this.setStatus(
        "Unable to derive nickname from Midnight wallet address.",
        true,
      );
      return;
    }

    this.setLoading(this.joinBtn, true, "Join Game");
    const appearanceCode = encodeAppearance(this.avatarSelection);

    const walletClient = evmWallet.getWalletClient();

    // Stop game info polling since player is joining
    if (this.gameInfoPollTimer) {
      clearInterval(this.gameInfoPollTimer);
      this.gameInfoPollTimer = null;
    }

    try {
      // ── 1. Derive deterministic Ed25519 keypair from EVM wallet ───────────
      // Local wallet signs "werewolf:{gameId}" for deterministic key derivation.
      this.setStatus("Deriving game keypair… (local signature 1/2)");
      const keypair = await deriveGameKeypair(
        address,
        this.currentGame.id,
        walletClient,
      );
      const publicKeyHex = bytesToHex(keypair.publicKey);
      gameState.playerSignKeypair = keypair;
      gameState.publicKeyHex = publicKeyHex;
      console.log("[LobbyScreen] derived Ed25519 publicKeyHex:", publicKeyHex);

      // ── 2. Submit join via batcher (EVM signature) ────────────────────────
      // Local wallet signs the batcher message without an extension prompt.
      this.setStatus("Signing batcher message… (local signature 2/2)");
      console.log("[LobbyScreen] calling BatcherService.joinGame", {
        address,
        gameId: this.currentGame.id,
        publicKeyHex,
        nickname,
        appearanceCode,
        midnightAddress,
      });
      const batcherResult = await BatcherService.joinGame(
        address,
        this.currentGame.id,
        publicKeyHex,
        nickname,
        appearanceCode,
        midnightAddress,
        ({ message }) =>
          walletClient.signMessage({ message, account: undefined }),
      );
      console.log("[LobbyScreen] batcher joinGame result:", batcherResult);

      // ── 2a. Persist session immediately so a page reload before the game  ──
      // starts can still detect that the player already joined this lobby.
      // (main.ts also calls saveSession after bundles are ready, but that's
      //  too late if the player refreshes while still in the waiting room.)
      saveSession({
        gameId: this.currentGame.id,
        publicKeyHex,
        nickname,
        appearanceCode,
        evmAddress: address,
        bundle: null,
      });

      // ── 2b. Register proxy wallet on first join (fire-and-forget) ─────────
      if (
        this._usingProxy && !localStorage.getItem("werewolf:proxy-registered")
      ) {
        void BatcherService.registerProxyWallet(
          address,
          midnightAddress,
          ({ message }) =>
            walletClient.signMessage({ message, account: undefined }),
        ).then(() => {
          localStorage.setItem("werewolf:proxy-registered", "1");
          console.log("[LobbyScreen] Proxy wallet registered on-chain");
        }).catch((err) => {
          console.warn(
            "[LobbyScreen] registerProxyWallet failed (will retry next join):",
            err,
          );
        });
      }

      // ── 3. Wait for lobby to close and bundles to be ready ────────────────
      this.setStatus("Joined! Waiting for lobby to close…");
      this.joinBtn.hidden = true;
      this.nicknameInfoEl.hidden = true;
      this.avatarSection.classList.add("lobby-avatar-card--locked");

      const gameId = this.currentGame.id;
      await this.pollForBundles(
        gameId,
        publicKeyHex,
        keypair.secretKey,
        nickname,
        appearanceCode,
      );
    } catch (err) {
      console.error("[LobbyScreen] handleJoinGame error:", err);
      this.setLoading(this.joinBtn, false, "Join Game");
      this.setStatus(`Error: ${(err as Error).message}`, true);
    }
  }

  /**
   * Scans localStorage for persisted game sessions and renders "Rejoin" tiles
   * for games that are still active on the server.
   *
   * Uses localStorage as the source of truth for which games to show (rather
   * than querying the DB by EVM address) so that the section appears reliably
   * on page refresh regardless of whether the EVM address is stored in the DB.
   * The Ed25519 keypair is NOT read from localStorage — it is re-derived on
   * demand via `deriveGameKeypair` when the player clicks Rejoin.
   */
  private async loadActiveGames(_evmAddress: string): Promise<void> {
    try {
      const sessions = getAllSessions();
      if (sessions.length === 0) return;

      // Fetch current lobby status for each session in parallel.
      const results = await Promise.allSettled(
        sessions.map(async (s) => {
          const status = await fetchLobbyStatus(s.gameId);
          return { session: s, status };
        }),
      );

      // Sessions whose status fetch failed (404, network error) → game is gone → clean up.
      results.forEach((r, i) => {
        if (r.status === "rejected") clearSession(sessions[i].gameId);
      });

      // Finished games outside the 60-minute window (server-evaluated) → clean up.
      results.forEach((r, i) => {
        if (
          r.status === "fulfilled" && r.value.status.finished &&
          !r.value.status.finishedRecently
        ) {
          clearSession(sessions[i].gameId);
        }
      });

      const active = results
        .filter(
          (
            r,
          ): r is PromiseFulfilledResult<
            { session: StoredSession; status: LobbyStatusResponse }
          > =>
            r.status === "fulfilled" &&
            (!r.value.status.finished || r.value.status.finishedRecently),
        )
        .map((r) => r.value);

      if (active.length === 0) return;

      this.activeGamesSection.hidden = false;
      this.activeGamesSection.innerHTML = `
        <h3 class="lobby-section-title">Your Active Games</h3>
        ${
        active.map(({ session, status }) => {
          let statusLabel: string;
          if (status.finished) {
            statusLabel = "✅ Finished";
          } else if (status.state === "open") {
            statusLabel = "🟢 Open";
          } else if (!status.bundlesReady) {
            statusLabel = "⏳ Waiting for bundles";
          } else {
            statusLabel = "🎮 In Progress";
          }
          return `
            <div class="lobby-game-tile" data-game-id="${session.gameId}">
              <div class="lobby-game-tile-info">
                <span class="lobby-game-tile-id">${
            encodeGameId(session.gameId)
          }</span>
                <span class="lobby-game-tile-status">${statusLabel}</span>
                <span class="lobby-game-tile-nick">${session.nickname}</span>
              </div>
              <button class="ui-btn lobby-btn lobby-btn--rejoin" data-rejoin-id="${session.gameId}">
                Rejoin
              </button>
            </div>
          `;
        }).join("")
      }
      `;

      // Attach click handlers — Rejoin always available since session exists in localStorage.
      active.forEach(({ session, status }) => {
        const btn = this.activeGamesSection.querySelector<HTMLButtonElement>(
          `[data-rejoin-id="${session.gameId}"]`,
        );
        btn?.addEventListener(
          "click",
          () => void this.handleRejoinGame(session, status),
        );
      });
    } catch (err) {
      console.warn("[LobbyScreen] Failed to load active games:", err);
    }
  }

  /**
   * Rejoins a game after a page refresh by re-deriving the Ed25519 keypair
   * deterministically from the player's EVM wallet and
   * then restoring or re-fetching the bundle.
   *
   * Three cases:
   *  1. Bundle cached in localStorage → restore immediately, call onJoined.
   *  2. Bundle not cached but ready on server → re-fetch via derived keypair.
   *  3. Bundle not yet ready → resume pollForBundles to wait for it.
   */
  private async handleRejoinGame(
    session: StoredSession,
    status: LobbyStatusResponse,
  ): Promise<void> {
    // ── Race guard ────────────────────────────────────────────────────────────
    // If a rejoin for this game (or any game) is already running, ignore the
    // second call. This prevents the "Your Active Games" Rejoin tile from
    // racing with the auto-rejoin triggered by `autoDiscoverLobby`.
    if (this._rejoinInProgress !== null) {
      console.log(
        "[LobbyScreen] handleRejoinGame ignored — already in progress for game",
        this._rejoinInProgress,
      );
      return;
    }
    this._rejoinInProgress = session.gameId;
    // Disable any Rejoin tile buttons so the player can't click through.
    this.activeGamesSection
      .querySelectorAll<HTMLButtonElement>("[data-rejoin-id]")
      .forEach((b) => {
        b.disabled = true;
      });

    try {
      const address = evmWallet.getAddress();
      const appearanceCode = session.appearanceCode ?? 0;
      if (!address) {
        this.setStatus("EVM wallet not connected.", true);
        return;
      }

      // Re-derive the Ed25519 keypair via the local EVM signer.
      this.setStatus("Deriving game keypair… (local signature)");
      const walletClient = evmWallet.getWalletClient();

      let keypair: nacl.SignKeyPair;
      try {
        keypair = await deriveGameKeypair(
          address,
          session.gameId,
          walletClient,
        );
      } catch (err) {
        this.setStatus(
          `Keypair derivation failed: ${(err as Error).message}`,
          true,
        );
        return;
      }

      gameState.playerSignKeypair = keypair;
      gameState.publicKeyHex = session.publicKeyHex;

      if (session.bundle) {
        // ── Case 1: bundle cached locally ───────────────────────────────────
        gameState.leafSecret = session.bundle.leafSecret;
        gameState.setPlayerBundle(session.bundle as PlayerBundle);
        this.setStatus("Session restored! Loading game…");
        this.onJoined(
          session.gameId,
          true,
          session.publicKeyHex,
          session.nickname,
          appearanceCode,
        );
      } else if (status.bundlesReady) {
        // ── Case 2: bundle on server but not cached — re-fetch via derived key
        this.setStatus("Fetching your bundle…");
        try {
          const bundle = await fetchBundle(
            session.gameId,
            session.publicKeyHex,
            keypair.secretKey,
          );
          gameState.leafSecret = bundle.leafSecret;
          gameState.setPlayerBundle(bundle);
          this.setStatus("Bundle received! Loading game…");
          this.onJoined(
            session.gameId,
            true,
            session.publicKeyHex,
            session.nickname,
            appearanceCode,
          );
        } catch (err) {
          console.error(
            "[LobbyScreen] Session restore bundle fetch error:",
            err,
            {
              gameId: session.gameId,
              publicKeyHex: session.publicKeyHex,
            },
          );
          toastManager.error("Failed to fetch bundle — try again.");
          this.setStatus(
            `Failed to fetch bundle: ${(err as Error).message}`,
            true,
          );
        }
      } else {
        // ── Case 3: bundles not ready yet — wait for them ───────────────────
        // Restore the avatar to what the player chose when they first joined,
        // show the locked avatar card, and surface the game-info panel so
        // that pollForBundles can update it while we wait.
        try {
          const sel = decodeAppearance(appearanceCode);
          this.avatarSelection = sel;
          this.syncAvatarSelection();
        } catch {
          // invalid appearanceCode — just leave the current avatar in place
        }
        this.gameInfoEl.innerHTML = `
          <div class="lobby-game-row"><span>Game Phrase</span><strong>${
          encodeGameId(session.gameId)
        }</strong></div>
          <div class="lobby-game-row"><span>Status</span><strong>⏳ Waiting…</strong></div>
        `;
        this.gameInfoEl.hidden = false;
        this.avatarSection.hidden = false;
        this.avatarSection.classList.add("lobby-avatar-card--locked");
        this.joinBtn.hidden = true;
        this.nicknameInfoEl.hidden = true;

        this.setStatus("Rejoined! Waiting for lobby to close…");
        try {
          await this.pollForBundles(
            session.gameId,
            session.publicKeyHex,
            keypair.secretKey,
            session.nickname,
            appearanceCode,
          );
        } catch (err) {
          this.setStatus(
            `Error waiting for bundles: ${(err as Error).message}`,
            true,
          );
        }
      }
    } finally {
      this._rejoinInProgress = null;
      // Re-enable any rejoin tile buttons that are still mounted.
      this.activeGamesSection
        .querySelectorAll<HTMLButtonElement>("[data-rejoin-id]")
        .forEach((b) => {
          b.disabled = false;
        });
    }
  }

  /**
   * Polls /api/lobby_status until bundles are ready, then fetches the bundle
   * and transitions to the game screen.
   */
  private pollForBundles(
    gameId: number,
    publicKeyHex: string,
    secretKey: Uint8Array,
    nickname: string,
    appearanceCode: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      const poll = async () => {
        try {
          const status = await fetchLobbyStatus(gameId);
          console.log("[LobbyScreen] lobby status:", status);

          // Update the game info display with live player count and timer
          if (this.gameInfoEl && !this.gameInfoEl.hidden) {
            const stateLabel = status.state === "open"
              ? "🟢 Open"
              : "🔴 Closed";
            let timerRow = "";
            if (
              status.state === "open" &&
              status.timeoutBlock != null &&
              status.currentBlock != null
            ) {
              const remaining = Math.max(
                0,
                status.timeoutBlock - status.currentBlock,
              );
              timerRow =
                `<div class="lobby-game-row"><span class="has-tooltip" data-tooltip="The game starts immediately when 16 players join. With 6–15 players, it auto-starts every 30 minutes." title="The game starts immediately when 16 players join. With 6–15 players, it auto-starts every 30 minutes.">Starts in</span><strong class="lobby-countdown">${
                  formatRemainingTime(remaining)
                }</strong></div>`;
            }
            this.gameInfoEl.innerHTML = `
              <div class="lobby-game-row"><span>Game Phrase</span><strong>${
              encodeGameId(gameId)
            }</strong></div>
              <div class="lobby-game-row"><span>Status</span><strong>${stateLabel}</strong></div>
              <div class="lobby-game-row"><span>Players</span><strong>${status.playerCount} / ${status.maxPlayers}</strong></div>
              ${timerRow}
            `;
          }

          if (status.bundlesReady) {
            // Bundles are ready — fetch ours
            if (this.lobbyPollTimer) {
              clearInterval(this.lobbyPollTimer);
              this.lobbyPollTimer = null;
            }
            this.setStatus("Bundles ready! Fetching your bundle…");

            try {
              const bundle = await fetchBundle(gameId, publicKeyHex, secretKey);
              gameState.leafSecret = bundle.leafSecret;
              gameState.setPlayerBundle(bundle);

              this.setStatus("Bundle received! Loading game…");
              this.onJoined(
                gameId,
                true,
                publicKeyHex,
                nickname,
                appearanceCode,
              );
              resolve();
            } catch (err) {
              console.error(
                "[LobbyScreen] PollForBundles bundle fetch error:",
                err,
                { gameId, publicKeyHex },
              );
              toastManager.error("Failed to fetch bundle — try again.");
              this.setStatus("Failed to fetch bundle — try again.", true);
              // Keep polling even after error - don't resolve
            }
          } else if (status.state === "closed" && !status.bundlesReady) {
            this.setStatus("Lobby closed. Generating bundles…");
          } else {
            this.setStatus(
              `Waiting for players… (${status.playerCount}/${status.maxPlayers})`,
            );
            this.startHintEl.hidden = false;
          }
        } catch (err) {
          console.error("[LobbyScreen] lobby poll error:", err);
          // Don't reject — keep polling through transient errors
        }
      };

      // Initial poll immediately
      poll();
      this.lobbyPollTimer = setInterval(poll, LOBBY_POLL_INTERVAL_MS);
    });
  }

  /**
   * Associates the proxy Midnight wallet with a real Lace wallet address.
   * Requires Lace to be installed. Submits claim_real_wallet via the batcher.
   */
  private async handleAssociateWallets(): Promise<void> {
    const evmAddress = evmWallet.getAddress();
    const proxyMidnightAddress = midnightWallet.getShieldedAddress();

    if (!evmAddress || !proxyMidnightAddress) {
      this.setStatus("Wallets not initialised. Cannot associate.", true);
      return;
    }

    if (!midnightWallet.isAvailable()) {
      this.setStatus(
        "Lace wallet not detected. Install Lace to associate your wallet.",
        true,
      );
      return;
    }

    this.setStatus("Connecting Lace to get real Midnight address…");

    let realMidnightAddress: string;
    try {
      const entry = Object.entries(window.midnight!).find(([_, api]) =>
        !!api.apiVersion
      );
      if (!entry) throw new Error("No compatible Lace wallet found.");
      const [, api] = entry;
      const laceAPI = await api.connect(MIDNIGHT_NETWORK_ID);
      const addresses = await laceAPI.getShieldedAddresses();
      realMidnightAddress = addresses.shieldedAddress;
    } catch (err) {
      this.setStatus(`Lace connection failed: ${(err as Error).message}`, true);
      return;
    }

    if (realMidnightAddress === proxyMidnightAddress) {
      this.setStatus(
        "The Lace address matches your proxy address — no migration needed.",
        false,
      );
      this.proxyBadgeEl.hidden = true;
      this.associateSection.hidden = true;
      return;
    }

    this.setStatus("Submitting wallet association…");
    const walletClient = evmWallet.getWalletClient()!;

    try {
      await BatcherService.claimRealWallet(
        evmAddress,
        proxyMidnightAddress,
        realMidnightAddress,
        ({ message }) =>
          walletClient.signMessage({ message, account: undefined }),
      );
      this.proxyBadgeEl.hidden = true;
      this.associateSection.hidden = true;
      this.setStatus(
        "Wallets associated! Leaderboard points will be migrated to your Lace address.",
      );
      console.log(
        "[LobbyScreen] Wallet association submitted: proxy →",
        proxyMidnightAddress.slice(0, 16) + "…",
        "real →",
        realMidnightAddress.slice(0, 16) + "…",
      );
    } catch (err) {
      this.setStatus(`Association failed: ${(err as Error).message}`, true);
    }
  }
}
