import { evmWallet } from '../services/evmWallet'
import { getGameState, deriveMidnightAddressHash, type GameInfo } from '../services/lobbyContract'
import { BatcherService } from '../services/batcherService'
import { gameState, type PlayerBundle } from '../state/gameState'
import { decodeGamePhrase, isGamePhrase } from '../services/werewolfIdCodec'

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:9999'

export class LobbyScreen {
  onJoined: (gameId: number, gameStarted: boolean, midnightAddressHash: string, nickname: string) => void = () => {}

  private container: HTMLDivElement
  private statusEl!: HTMLParagraphElement
  private walletBtn!: HTMLButtonElement
  private walletAddressEl!: HTMLSpanElement
  private gameSection!: HTMLDivElement
  private gameIdInput!: HTMLInputElement
  private nicknameInput!: HTMLInputElement
  private findBtn!: HTMLButtonElement
  private gameInfoEl!: HTMLDivElement
  private joinBtn!: HTMLButtonElement

  private currentGame: GameInfo | null = null

  constructor() {
    this.container = document.createElement('div')
    this.container.className = 'lobby-screen'
    this.container.innerHTML = `
      <div class="lobby-card">
        <h1 class="lobby-title">Werewolf</h1>
        <p class="lobby-subtitle">Midnight &times; EVM</p>

        <section class="lobby-wallet-section">
          <button id="lobbyWalletBtn" class="ui-btn lobby-btn">Connect MetaMask</button>
          <span id="lobbyWalletAddress" class="lobby-address"></span>
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
    this.walletAddressEl = this.container.querySelector<HTMLSpanElement>('#lobbyWalletAddress')!
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

  private async handleConnectWallet(): Promise<void> {
    if (!evmWallet.isAvailable()) {
      this.setStatus('MetaMask not found. Please install it and reload.', true)
      return
    }

    this.setLoading(this.walletBtn, true, 'Connect MetaMask')
    this.setStatus('')

    try {
      const state = await evmWallet.connect()
      this.walletBtn.textContent = 'Connected'
      this.walletBtn.disabled = true
      this.walletAddressEl.textContent = state.address ?? ''
      this.gameSection.hidden = false
      this.setStatus('Wallet connected. Enter a Game ID to join.')
    } catch (err) {
      this.setLoading(this.walletBtn, false, 'Connect MetaMask')
      this.setStatus(`Connection failed: ${(err as Error).message}`, true)
    }
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
      this.setStatus('Wallet not connected. Please connect MetaMask first.', true)
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
    this.setStatus('Signing batcher message...')

    try {
      const walletClient = evmWallet.getWalletClient()

      // Derive a bytes32 placeholder from the EVM address.
      // TODO: Replace with the player's Midnight shielded address hash once
      // Midnight wallet integration is added to frontend-ui.
      const midnightAddressHash = await deriveMidnightAddressHash(address)
      console.log('[LobbyScreen] midnightAddressHash:', midnightAddressHash)

      this.setStatus('Submitting to batcher...')
      console.log('[LobbyScreen] calling BatcherService.joinGame', { address, gameId: this.currentGame.id, midnightAddressHash, nickname })
      const batcherResult = await BatcherService.joinGame(
        address,
        this.currentGame.id,
        midnightAddressHash,
        nickname,
        ({ message }) => walletClient.signMessage({ account: address, message }),
      )
      console.log('[LobbyScreen] batcher joinGame result:', batcherResult)

      this.setStatus('Fetching player bundle...')
      const bundleUrl = `${API_BASE}/api/join_game?gameId=${this.currentGame.id}&midnightAddressHash=${encodeURIComponent(midnightAddressHash)}&nickname=${encodeURIComponent(nickname)}`
      console.log('[LobbyScreen] fetching player bundle:', bundleUrl)
      const bundleRes = await fetch(bundleUrl, { method: 'POST' })
      console.log('[LobbyScreen] bundle response status:', bundleRes.status)
      if (!bundleRes.ok) {
        const text = await bundleRes.text()
        throw new Error(`Failed to get player bundle: ${bundleRes.status} ${text}`)
      }
      const bundleData = await bundleRes.json() as {
        success: boolean
        message?: string
        bundle?: PlayerBundle
        gameStarted?: boolean
      }
      console.log('[LobbyScreen] bundle data:', bundleData)
      if (bundleData.bundle) {
        gameState.setPlayerBundle(bundleData.bundle)
      }

      this.setStatus('Joined successfully! Loading game...')
      this.joinBtn.hidden = true
      this.nicknameInput.hidden = true
      this.onJoined(this.currentGame.id, bundleData.gameStarted ?? false, midnightAddressHash, nickname)
    } catch (err) {
      console.error('[LobbyScreen] handleJoinGame error:', err)
      this.setLoading(this.joinBtn, false, 'Join Game')
      this.setStatus(`Error: ${(err as Error).message}`, true)
    }
  }
}
