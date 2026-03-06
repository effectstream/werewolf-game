import nacl from 'tweetnacl'
import { evmWallet } from '../services/evmWallet'
import { midnightWallet } from '../services/midnightWallet'
import { getGameState, type GameInfo } from '../services/lobbyContract'
import { BatcherService } from '../services/batcherService'
import { gameState, type PlayerBundle } from '../state/gameState'
import { fetchBundle, fetchLobbyStatus, fetchOpenLobby } from '../services/lobbyApi'
import { decodeGamePhrase, isGamePhrase } from '../services/werewolfIdCodec'

const MIDNIGHT_NETWORK_ID =
  (import.meta.env.VITE_MIDNIGHT_NETWORK_ID as string | undefined) ?? 'undeployed'
const LOBBY_POLL_INTERVAL_MS = 4000

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export class LobbyScreen {
  onJoined: (gameId: number, gameStarted: boolean, publicKeyHex: string, nickname: string) => void = () => {}

  private static readonly DISCOVER_POLL_MS = 3_000     // ms between /api/open_lobby retries
  private static readonly DISCOVER_TIMEOUT_MS = 60_000 // give up after 60 s

  private container: HTMLDivElement
  private statusEl!: HTMLParagraphElement
  private walletBtn!: HTMLButtonElement
  private evmAddressEl!: HTMLSpanElement
  private midnightAddressEl!: HTMLSpanElement
  private gameSection!: HTMLDivElement
  private gameIdInput!: HTMLInputElement
  private nicknameInput!: HTMLInputElement
  private findBtn!: HTMLButtonElement
  private gameInfoEl!: HTMLDivElement
  private joinBtn!: HTMLButtonElement

  private currentGame: GameInfo | null = null
  private lobbyPollTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.container = document.createElement('div')
    this.container.className = 'lobby-screen'
    this.container.innerHTML = `
      <div class="lobby-card">
        <h1 class="lobby-title">Werewolf</h1>
        <p class="lobby-subtitle">Midnight &times; EVM</p>

        <section class="lobby-wallet-section">
          <button id="lobbyWalletBtn" class="ui-btn lobby-btn">Connect Browser Wallets</button>
          <div id="lobbyWalletInfo" class="lobby-wallet-info" hidden>
            <span id="lobbyEvmAddress" class="lobby-address lobby-address--evm"></span>
            <br />
            <span id="lobbyMidnightAddress" class="lobby-address lobby-address--midnight"></span>
          </div>
        </section>

        <section id="lobbyGameSection" class="lobby-game-section" hidden>
          <div class="lobby-row">
            <input id="lobbyGameIdInput" class="lobby-input" type="text" placeholder="Game ID or 4-word phrase" />
            <button id="lobbyFindBtn" class="ui-btn lobby-btn">Find Game</button>
          </div>
          <div id="lobbyGameInfo" class="lobby-game-info" hidden></div>
          <input id="lobbyNicknameInput" class="lobby-input" type="text" placeholder="Nickname (min 3 characters)" hidden />
          <button id="lobbyJoinBtn" class="ui-btn lobby-btn lobby-btn--primary" hidden>Join Game</button>
        </section>

        <p id="lobbyStatus" class="lobby-status"></p>
      </div>
    `

    this.walletBtn = this.container.querySelector<HTMLButtonElement>('#lobbyWalletBtn')!
    this.evmAddressEl = this.container.querySelector<HTMLSpanElement>('#lobbyEvmAddress')!
    this.midnightAddressEl = this.container.querySelector<HTMLSpanElement>('#lobbyMidnightAddress')!
    this.gameSection = this.container.querySelector<HTMLDivElement>('#lobbyGameSection')!
    this.gameIdInput = this.container.querySelector<HTMLInputElement>('#lobbyGameIdInput')!
    this.nicknameInput = this.container.querySelector<HTMLInputElement>('#lobbyNicknameInput')!
    this.findBtn = this.container.querySelector<HTMLButtonElement>('#lobbyFindBtn')!
    this.gameInfoEl = this.container.querySelector<HTMLDivElement>('#lobbyGameInfo')!
    this.joinBtn = this.container.querySelector<HTMLButtonElement>('#lobbyJoinBtn')!
    this.statusEl = this.container.querySelector<HTMLParagraphElement>('#lobbyStatus')!

    this.walletBtn.addEventListener('click', () => this.handleConnectWallet())
    this.findBtn.addEventListener('click', () => this.handleFindGame())
    this.joinBtn.addEventListener('click', () => this.handleJoinGame())
  }

  show(): void {
    const app = document.querySelector<HTMLDivElement>('#app')!
    app.innerHTML = ''
    app.appendChild(this.container)
  }

  hide(): void {
    if (this.lobbyPollTimer) {
      clearInterval(this.lobbyPollTimer)
      this.lobbyPollTimer = null
    }
    this.container.remove()
  }

  private setStatus(msg: string, isError = false): void {
    this.statusEl.textContent = msg
    this.statusEl.classList.toggle('lobby-status--error', isError)
  }

  private setLoading(btn: HTMLButtonElement, loading: boolean, label: string): void {
    btn.disabled = loading
    btn.textContent = loading ? '...' : label
  }

  /**
   * Connects both the EVM wallet (MetaMask / any EIP-1193 provider) and the
   * Midnight wallet (Lace browser extension). Both are required — if either
   * fails the flow stops with an error.
   */
  private async handleConnectWallet(): Promise<void> {
    if (!evmWallet.isAvailable()) {
      this.setStatus('No EVM wallet detected. Please install MetaMask and reload.', true)
      return
    }

    this.setLoading(this.walletBtn, true, 'Connect Browser Wallets')
    this.setStatus('Connecting EVM wallet…')

    // ── 1. EVM wallet ─────────────────────────────────────────────────────────
    let evmAddress: `0x${string}`
    try {
      const evmState = await evmWallet.connect()
      evmAddress = evmState.address!
      this.evmAddressEl.textContent = `EVM: ${evmAddress}`
      console.log('[LobbyScreen] EVM wallet connected:', evmAddress)
    } catch (err) {
      this.setLoading(this.walletBtn, false, 'Connect Browser Wallets')
      this.setStatus(`EVM wallet connection failed: ${(err as Error).message}`, true)
      return
    }

    // ── 2. Midnight wallet (Lace) ─────────────────────────────────────────────
    this.setStatus('Connecting Midnight wallet…')

    if (!midnightWallet.isAvailable()) {
      this.setLoading(this.walletBtn, false, 'Connect Browser Wallets')
      this.setStatus('Midnight wallet not found. Please install the Lace extension and reload.', true)
      return
    }

    try {
      const midnightState = await midnightWallet.connect(MIDNIGHT_NETWORK_ID)
      const shielded = midnightState.shieldedAddress!
      const displayAddr = shielded.length > 24
        ? `${shielded.slice(0, 12)}…${shielded.slice(-8)}`
        : shielded
      this.midnightAddressEl.textContent = `Midnight: ${displayAddr}`
      console.log('[LobbyScreen] Midnight wallet connected:', shielded)
    } catch (err) {
      this.setLoading(this.walletBtn, false, 'Connect Browser Wallets')
      this.setStatus(`Midnight wallet connection failed: ${(err as Error).message}`, true)
      return
    }

    // ── 3. Reveal wallet info and game section ────────────────────────────────
    const walletInfo = this.container.querySelector<HTMLDivElement>('#lobbyWalletInfo')!
    walletInfo.hidden = false
    this.walletBtn.textContent = 'Wallets Connected'
    this.walletBtn.disabled = true
    this.gameSection.hidden = false
    this.setStatus('Searching for open lobby…')
    void this.autoDiscoverLobby()
  }

  private async autoDiscoverLobby(): Promise<void> {
    const deadline = Date.now() + LobbyScreen.DISCOVER_TIMEOUT_MS
    let attempt = 0
    while (Date.now() < deadline) {
      try {
        const open = await fetchOpenLobby()
        if (open) {
          this.gameIdInput.value = String(open.gameId)
          await this.handleFindGame()
          return
        }
      } catch {
        // transient network error — keep retrying
      }
      attempt++
      this.setStatus(`Waiting for lobby… (${attempt})`)
      await new Promise<void>((r) => setTimeout(r, LobbyScreen.DISCOVER_POLL_MS))
    }
    this.setStatus('No open lobby found. Enter a Game ID to join.')
  }

  private async handleFindGame(): Promise<void> {
    const raw = this.gameIdInput.value.trim()
    console.log('[LobbyScreen] handleFindGame raw input:', raw)

    let gameId: number
    if (isGamePhrase(raw)) {
      try {
        gameId = decodeGamePhrase(raw)
        console.log('[LobbyScreen] decoded game phrase to ID:', gameId)
      } catch (err) {
        console.error('[LobbyScreen] failed to decode phrase:', err)
        this.setStatus(`Invalid phrase: ${(err as Error).message}`, true)
        return
      }
    } else {
      gameId = parseInt(raw, 10)
      if (isNaN(gameId) || gameId < 1) {
        this.setStatus('Enter a valid Game ID or 4-word phrase.', true)
        return
      }
      console.log('[LobbyScreen] parsed numeric game ID:', gameId)
    }

    this.setLoading(this.findBtn, true, 'Find Game')
    this.setStatus('')
    this.gameInfoEl.hidden = true
    this.joinBtn.hidden = true
    this.currentGame = null

    try {
      console.log('[LobbyScreen] calling getGameState for gameId:', gameId)
      const game = await getGameState(gameId)
      this.currentGame = game
      console.log('[LobbyScreen] getGameState result:', game)

      const stateLabel = game.state === 'Open' ? '🟢 Open' : '🔴 Closed'
      this.gameInfoEl.innerHTML = `
        <div class="lobby-game-row"><span>Game ID</span><strong>${game.id}</strong></div>
        <div class="lobby-game-row"><span>Status</span><strong>${stateLabel}</strong></div>
        <div class="lobby-game-row"><span>Players</span><strong>${game.playerCount} / ${game.maxPlayers}</strong></div>
      `
      this.gameInfoEl.hidden = false

      if (game.state === 'Open' && game.playerCount < game.maxPlayers) {
        this.nicknameInput.hidden = false
        this.joinBtn.hidden = false
        this.setStatus('Game is open. Enter a nickname and join.')
      } else if (game.state === 'Closed') {
        this.nicknameInput.hidden = true
        this.setStatus('This game is closed.', true)
      } else {
        this.nicknameInput.hidden = true
        this.setStatus('This game is full.', true)
      }
    } catch (err) {
      console.error('[LobbyScreen] getGameState error:', err)
      this.setStatus(`Error: ${(err as Error).message}`, true)
    } finally {
      this.setLoading(this.findBtn, false, 'Find Game')
    }
  }

  private async handleJoinGame(): Promise<void> {
    const address = evmWallet.getAddress()
    console.log('[LobbyScreen] handleJoinGame address:', address, 'currentGame:', this.currentGame)
    if (!address) {
      this.setStatus('Wallet not connected. Please connect your wallets first.', true)
      return
    }
    if (!this.currentGame) {
      this.setStatus('No game selected. Please find a game first.', true)
      return
    }

    const nickname = this.nicknameInput.value.trim()
    if (nickname.length < 3) {
      this.setStatus('Nickname must be at least 3 characters.', true)
      return
    }

    this.setLoading(this.joinBtn, true, 'Join Game')
    this.setStatus('Generating signing keypair…')

    try {
      // ── 1. Generate Ed25519 keypair for this session ──────────────────────
      const keypair = nacl.sign.keyPair()
      const publicKeyHex = bytesToHex(keypair.publicKey)
      gameState.playerSignKeypair = keypair
      gameState.publicKeyHex = publicKeyHex
      console.log('[LobbyScreen] generated Ed25519 publicKeyHex:', publicKeyHex)

      // ── 2. Submit join via batcher (EVM signature) ────────────────────────
      this.setStatus('Signing batcher message…')
      const walletClient = evmWallet.getWalletClient()
      console.log('[LobbyScreen] calling BatcherService.joinGame', { address, gameId: this.currentGame.id, publicKeyHex, nickname })
      const batcherResult = await BatcherService.joinGame(
        address,
        this.currentGame.id,
        publicKeyHex,
        nickname,
        ({ message }) => walletClient.signMessage({ account: address, message }),
      )
      console.log('[LobbyScreen] batcher joinGame result:', batcherResult)

      // ── 3. Wait for lobby to close and bundles to be ready ────────────────
      this.setStatus('Joined! Waiting for lobby to close…')
      this.joinBtn.hidden = true
      this.nicknameInput.hidden = true

      const gameId = this.currentGame.id
      await this.pollForBundles(gameId, publicKeyHex, keypair.secretKey, nickname)
    } catch (err) {
      console.error('[LobbyScreen] handleJoinGame error:', err)
      this.setLoading(this.joinBtn, false, 'Join Game')
      this.setStatus(`Error: ${(err as Error).message}`, true)
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
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const status = await fetchLobbyStatus(gameId)
          console.log('[LobbyScreen] lobby status:', status)

          // Update the game info display with live player count
          if (this.gameInfoEl && !this.gameInfoEl.hidden) {
            const stateLabel = status.state === 'open' ? '🟢 Open' : '🔴 Closed'
            this.gameInfoEl.innerHTML = `
              <div class="lobby-game-row"><span>Game ID</span><strong>${gameId}</strong></div>
              <div class="lobby-game-row"><span>Status</span><strong>${stateLabel}</strong></div>
              <div class="lobby-game-row"><span>Players</span><strong>${status.playerCount} / ${status.maxPlayers}</strong></div>
            `
          }

          if (status.bundlesReady) {
            // Bundles are ready — fetch ours
            if (this.lobbyPollTimer) {
              clearInterval(this.lobbyPollTimer)
              this.lobbyPollTimer = null
            }
            this.setStatus('Bundles ready! Fetching your bundle…')

            const bundle = await fetchBundle(gameId, publicKeyHex, secretKey)
            gameState.leafSecret = bundle.leafSecret
            gameState.setPlayerBundle(bundle)

            this.setStatus('Bundle received! Loading game…')
            this.onJoined(gameId, true, publicKeyHex, nickname)
            resolve()
          } else if (status.state === 'closed' && !status.bundlesReady) {
            this.setStatus('Lobby closed. Generating bundles…')
          } else {
            this.setStatus(`Waiting for players… (${status.playerCount}/${status.maxPlayers})`)
          }
        } catch (err) {
          console.error('[LobbyScreen] lobby poll error:', err)
          // Don't reject — keep polling through transient errors
        }
      }

      // Initial poll immediately
      poll()
      this.lobbyPollTimer = setInterval(poll, LOBBY_POLL_INTERVAL_MS)
    })
  }
}
