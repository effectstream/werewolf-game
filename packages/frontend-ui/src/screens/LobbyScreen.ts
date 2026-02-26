import { evmWallet } from '../services/evmWallet'
import { getGameState, joinGame, deriveMidnightAddressHash, type GameInfo } from '../services/lobbyContract'

export class LobbyScreen {
  onJoined: (gameId: number) => void = () => {}

  private container: HTMLDivElement
  private statusEl!: HTMLParagraphElement
  private walletBtn!: HTMLButtonElement
  private walletAddressEl!: HTMLSpanElement
  private gameSection!: HTMLDivElement
  private gameIdInput!: HTMLInputElement
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
            <input id="lobbyGameIdInput" class="lobby-input" type="number" min="1" placeholder="Game ID" />
            <button id="lobbyFindBtn" class="ui-btn lobby-btn">Find Game</button>
          </div>
          <div id="lobbyGameInfo" class="lobby-game-info" hidden></div>
          <button id="lobbyJoinBtn" class="ui-btn lobby-btn lobby-btn--primary" hidden>Join Game</button>
        </section>

        <p id="lobbyStatus" class="lobby-status"></p>
      </div>
    `

    this.walletBtn = this.container.querySelector<HTMLButtonElement>('#lobbyWalletBtn')!
    this.walletAddressEl = this.container.querySelector<HTMLSpanElement>('#lobbyWalletAddress')!
    this.gameSection = this.container.querySelector<HTMLDivElement>('#lobbyGameSection')!
    this.gameIdInput = this.container.querySelector<HTMLInputElement>('#lobbyGameIdInput')!
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
    const gameId = parseInt(this.gameIdInput.value, 10)
    if (isNaN(gameId) || gameId < 1) {
      this.setStatus('Enter a valid Game ID.', true)
      return
    }

    this.setLoading(this.findBtn, true, 'Find Game')
    this.setStatus('')
    this.gameInfoEl.hidden = true
    this.joinBtn.hidden = true
    this.currentGame = null

    try {
      const publicClient = evmWallet.getPublicClient()
      const game = await getGameState(publicClient, gameId)
      this.currentGame = game

      const stateLabel = game.state === 'Open' ? '🟢 Open' : '🔴 Closed'
      this.gameInfoEl.innerHTML = `
        <div class="lobby-game-row"><span>Game ID</span><strong>${game.id}</strong></div>
        <div class="lobby-game-row"><span>Status</span><strong>${stateLabel}</strong></div>
        <div class="lobby-game-row"><span>Players</span><strong>${game.playerCount} / ${game.maxPlayers}</strong></div>
      `
      this.gameInfoEl.hidden = false

      if (game.state === 'Open' && game.playerCount < game.maxPlayers) {
        this.joinBtn.hidden = false
        this.setStatus('Game is open. You can join.')
      } else if (game.state === 'Closed') {
        this.setStatus('This game is closed.', true)
      } else {
        this.setStatus('This game is full.', true)
      }
    } catch (err) {
      this.setStatus(`Error: ${(err as Error).message}`, true)
    } finally {
      this.setLoading(this.findBtn, false, 'Find Game')
    }
  }

  private async handleJoinGame(): Promise<void> {
    const address = evmWallet.getAddress()
    if (!address || !this.currentGame) return

    this.setLoading(this.joinBtn, true, 'Join Game')
    this.setStatus('Waiting for MetaMask signature...')

    try {
      const walletClient = evmWallet.getWalletClient()
      const publicClient = evmWallet.getPublicClient()

      // Derive a bytes32 placeholder from the EVM address.
      // TODO: Replace with the player's Midnight shielded address hash once
      // Midnight wallet integration is added to frontend-ui.
      const midnightAddressHash = await deriveMidnightAddressHash(address)

      await joinGame(
        this.currentGame.id,
        midnightAddressHash,
        walletClient,
        publicClient,
        address,
      )

      this.setStatus('Joined successfully! Loading game...')
      this.joinBtn.hidden = true
      this.onJoined(this.currentGame.id)
    } catch (err) {
      this.setLoading(this.joinBtn, false, 'Join Game')
      const msg = (err as Error).message
      // Surface contract revert reasons when available
      const revertMatch = msg.match(/reverted with reason string '(.+?)'/)
      this.setStatus(
        revertMatch ? `Transaction reverted: ${revertMatch[1]}` : `Error: ${msg}`,
        true,
      )
    }
  }
}
