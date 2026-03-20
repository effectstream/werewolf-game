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
  type StoredSession,
} from "../services/sessionStore";
import { deriveNicknameFromMidnightAddress } from "../services/nicknameGenerator";
import {
  type AvatarSelection,
  encodeAppearance,
  HAIR_COLORS,
  HAIR_STYLE_LABELS,
  HAIR_STYLES,
  loadAvatarSelection,
  saveAvatarSelection,
  SHIRT_COLORS,
  SKIN_TONES,
} from "../avatarAppearance";
import { AvatarPreview } from "../ui/AvatarPreview";

const MIDNIGHT_NETWORK_ID =
  (import.meta.env.VITE_MIDNIGHT_NETWORK_ID as string | undefined) ??
    "undeployed";
const LOBBY_POLL_INTERVAL_MS = 4000;

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
  private static readonly DISCOVER_TIMEOUT_MS = 60_000; // give up after 60 s

  private container: HTMLDivElement;
  private statusEl!: HTMLParagraphElement;
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
  private joinBtn!: HTMLButtonElement;
  private laceModalBackdrop!: HTMLDivElement;
  private proxyBadgeEl!: HTMLSpanElement;
  private associateSection!: HTMLDivElement;

  private _usingProxy: boolean = false;
  private currentGame: GameInfo | null = null;
  private derivedNickname: string | null = null;
  private lobbyPollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly avatarPreview = new AvatarPreview(loadAvatarSelection());
  private avatarSelection: AvatarSelection = loadAvatarSelection();

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
          <button id="lobbyWalletBtn" class="ui-btn lobby-btn">Connect Wallet</button>
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
          <div class="lobby-row">
            <input id="lobbyGameIdInput" class="lobby-input" type="text" placeholder="Game ID or 4-word phrase" />
            <button id="lobbyFindBtn" class="ui-btn lobby-btn">Find Game</button>
          </div>
          <div id="lobbyGameInfo" class="lobby-game-info" hidden></div>
          <div id="lobbyNicknameInfo" class="lobby-game-info" hidden>
            <div class="lobby-game-row"><span>Nickname</span><strong id="lobbyNicknameValue"></strong></div>
          </div>
          <button id="lobbyJoinBtn" class="ui-btn lobby-btn lobby-btn--primary" hidden>Join Game</button>
        </section>

        <p id="lobbyStatus" class="lobby-status"></p>
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
    this.joinBtn = this.container.querySelector<HTMLButtonElement>(
      "#lobbyJoinBtn",
    )!;
    this.statusEl = this.container.querySelector<HTMLParagraphElement>(
      "#lobbyStatus",
    )!;

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

    this.avatarPreview.mount(this.avatarPreviewEl);
    this.bindAvatarControls();
    this.syncAvatarSelection();
  }

  show(): void {
    const app = document.querySelector<HTMLDivElement>("#app")!;
    app.innerHTML = "";
    app.appendChild(this.container);
  }

  hide(): void {
    if (this.lobbyPollTimer) {
      clearInterval(this.lobbyPollTimer);
      this.lobbyPollTimer = null;
    }
    this.avatarPreview.destroy();
    this.container.remove();
  }

  private setStatus(msg: string, isError = false): void {
    this.statusEl.textContent = msg;
    this.statusEl.classList.toggle("lobby-status--error", isError);
  }

  private setLoading(
    btn: HTMLButtonElement,
    loading: boolean,
    label: string,
  ): void {
    btn.disabled = loading;
    btn.textContent = loading ? "..." : label;
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

    // ── 2. Midnight wallet (Lace or proxy fallback) ───────────────────────────
    // Always attempt Lace first; isAvailable() is used only as a tiebreaker
    // when connect() throws, to distinguish "Lace present but failed" from
    // "Lace not installed".
    this.setStatus("Connecting Midnight wallet…");

    let shielded: string;

    try {
      const midnightState = await midnightWallet.connect(MIDNIGHT_NETWORK_ID);
      shielded = midnightState.shieldedAddress!;
      this._usingProxy = false;
      console.log("[LobbyScreen] Midnight wallet connected:", shielded);
    } catch (laceErr) {
      if (midnightWallet.isAvailable()) {
        // Lace is installed but the connection failed (user rejected, wrong network, etc.).
        // Surface the error — do not silently fall back to proxy.
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

      // Lace not installed → derive proxy wallet from EVM seed.
      this.setStatus("Lace not detected — initialising proxy wallet…");
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
        // Inform the player they are on a temporary wallet.
        this.laceModalBackdrop.hidden = false;
      } catch (proxyErr) {
        this.setLoading(this.walletBtn, false, "Connect Wallet");
        this.setStatus(
          `Proxy wallet initialisation failed: ${(proxyErr as Error).message}`,
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

    this.setLoading(this.findBtn, true, "Find Game");
    this.setStatus("");
    this.gameInfoEl.hidden = true;
    this.avatarSection.hidden = true;
    this.joinBtn.hidden = true;
    this.currentGame = null;

    try {
      console.log("[LobbyScreen] calling getGameState for gameId:", gameId);
      const game = await getGameState(gameId);
      this.currentGame = game;
      console.log("[LobbyScreen] getGameState result:", game);

      const stateLabel = game.state === "Open" ? "🟢 Open" : "🔴 Closed";
      this.gameInfoEl.innerHTML = `
        <div class="lobby-game-row"><span>Game Phrase</span><strong>${
        encodeGameId(game.id)
      }</strong></div>
        <div class="lobby-game-row"><span>Status</span><strong>${stateLabel}</strong></div>
        <div class="lobby-game-row"><span>Players</span><strong>${game.playerCount} / ${game.maxPlayers}</strong></div>
      `;
      this.gameInfoEl.hidden = false;

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
      this.avatarSection.hidden = true;

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

      const active = results
        .filter(
          (
            r,
          ): r is PromiseFulfilledResult<
            { session: StoredSession; status: LobbyStatusResponse }
          > => r.status === "fulfilled",
        )
        .map((r) => r.value);

      if (active.length === 0) return;

      this.activeGamesSection.hidden = false;
      this.activeGamesSection.innerHTML = `
        <h3 class="lobby-section-title">Your Active Games</h3>
        ${
        active.map(({ session, status }) => {
          let statusLabel: string;
          if (status.state === "open") {
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
      keypair = await deriveGameKeypair(address, session.gameId, walletClient);
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
      // ── Case 1: bundle cached locally ─────────────────────────────────────
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
      // ── Case 2: bundle on server but not cached — re-fetch using derived key
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
        this.setStatus(
          `Failed to fetch bundle: ${(err as Error).message}`,
          true,
        );
      }
    } else {
      // ── Case 3: bundles not ready yet — wait for them ─────────────────────
      this.setStatus("Waiting for bundles…");
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

          // Update the game info display with live player count
          if (this.gameInfoEl && !this.gameInfoEl.hidden) {
            const stateLabel = status.state === "open"
              ? "🟢 Open"
              : "🔴 Closed";
            this.gameInfoEl.innerHTML = `
              <div class="lobby-game-row"><span>Game Phrase</span><strong>${
              encodeGameId(gameId)
            }</strong></div>
              <div class="lobby-game-row"><span>Status</span><strong>${stateLabel}</strong></div>
              <div class="lobby-game-row"><span>Players</span><strong>${status.playerCount} / ${status.maxPlayers}</strong></div>
            `;
          }

          if (status.bundlesReady) {
            // Bundles are ready — fetch ours
            if (this.lobbyPollTimer) {
              clearInterval(this.lobbyPollTimer);
              this.lobbyPollTimer = null;
            }
            this.setStatus("Bundles ready! Fetching your bundle…");

            const bundle = await fetchBundle(gameId, publicKeyHex, secretKey);
            gameState.leafSecret = bundle.leafSecret;
            gameState.setPlayerBundle(bundle);

            this.setStatus("Bundle received! Loading game…");
            this.onJoined(gameId, true, publicKeyHex, nickname, appearanceCode);
            resolve();
          } else if (status.state === "closed" && !status.bundlesReady) {
            this.setStatus("Lobby closed. Generating bundles…");
          } else {
            this.setStatus(
              `Waiting for players… (${status.playerCount}/${status.maxPlayers})`,
            );
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
