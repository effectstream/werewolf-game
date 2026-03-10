import './style.css'
import * as THREE from 'three'

// UI and State
import { initLayout } from './ui/Layout'
import { HUDManager } from './ui/HUDManager'
import { ChatManager } from './ui/ChatManager'
import { PlayerListManager } from './ui/PlayerListManager'
import { RolePicker } from './ui/RolePicker'

// Scene
import { GameScene } from './scene/GameScene'
import { PlayerEntities } from './scene/PlayerEntities'
import { InteractionManager } from './scene/InteractionManager'
import { CameraControls } from './scene/CameraControls'

// Lobby
import { LobbyScreen } from './screens/LobbyScreen'
import { gameState, roleNumberToRole } from './state/gameState'
import { gameMaster } from './debug/GameMaster'
import { evmWallet } from './services/evmWallet'
import { fetchGameView, fetchGamePlayers } from './services/lobbyApi'
import { GameViewPoller, VoteStatusPoller } from './services/gameViewPoller'

/** Shows a full-screen announcement overlay for 4 seconds then fades out */
function showAnnouncement(message: string): void {
  const overlay = document.querySelector<HTMLDivElement>('#announcementOverlay')
  const textEl = document.querySelector<HTMLDivElement>('#announcementText')
  if (!overlay || !textEl) return

  textEl.textContent = message
  overlay.classList.remove('hidden', 'announcement-hiding')
  overlay.classList.add('announcement-visible')

  setTimeout(() => {
    overlay.classList.add('announcement-hiding')
    overlay.addEventListener('animationend', () => {
      overlay.classList.add('hidden')
      overlay.classList.remove('announcement-visible', 'announcement-hiding')
    }, { once: true })
  }, 4000)
}

interface GameManagers {
  hudManager: HUDManager
  chatManager: ChatManager
  werewolfChatManager?: ChatManager
  playerListManager: PlayerListManager
  rolePicker: RolePicker
  playerEntities: PlayerEntities
  poller: GameViewPoller
  votePoller: VoteStatusPoller
}

function destroyGame(managers: GameManagers): void {
  managers.hudManager.destroy()
  managers.chatManager.destroy()
  managers.werewolfChatManager?.destroy()
  managers.playerListManager.destroy()
  managers.rolePicker.destroy()
  managers.playerEntities.destroy()
  managers.poller.stop()
  managers.votePoller.stop()
}

async function bootGame(): Promise<GameManagers> {
  const gameId = gameState.lobbyGameId!

  // Fetch initial game view (ledger state — may lag on force-start)
  let initialPlayerCount = 0
  try {
    const initialView = await fetchGameView(gameId)
    gameState.applyGameView(initialView)
    initialPlayerCount = initialView.playerCount
  } catch (err) {
    console.warn('[bootGame] Failed to fetch initial game view:', err)
  }

  // Fetch player list to get index → nickname mapping.
  // The DB player count is the authoritative source — it's available immediately
  // even when the ledger hasn't settled yet (e.g. after a force-start).
  try {
    const playersResponse = await fetchGamePlayers(gameId)
    playersResponse.players.forEach((p, index) => {
      gameState.playerNicknames.set(p.playerId ?? index, p.nickname)
    })
    if (playersResponse.players.length > 0) {
      initialPlayerCount = playersResponse.players.length
    }
  } catch (err) {
    console.warn('[bootGame] Failed to fetch player nicknames, falling back to generated names:', err)
  }

  // Last-resort fallback if both fetches failed
  if (initialPlayerCount === 0) {
    console.warn('[bootGame] Could not determine player count, falling back to 8')
    initialPlayerCount = 8
  }

  // Bootstrap Layout
  initLayout()

  // Initialize UI Managers
  const hudManager = new HUDManager()
  const chatManager = new ChatManager()
  const playerListManager = new PlayerListManager()
  const rolePicker = new RolePicker()

  // Initialize Scene Layer
  const gameScene = new GameScene()
  const playerEntities = new PlayerEntities(gameScene.scene, chatManager, initialPlayerCount, (count) => {
    if (gameScene.table.userData.updateCardLayout) {
      gameScene.table.userData.updateCardLayout(count)
    }
  })

  // Wire up events
  rolePicker.onRoleSelected = (player, role) => {
    playerEntities.setPlayerRole(player, role)
  }
  playerListManager.buildPlayerList()

  new InteractionManager(gameScene.camera, gameScene.renderer.domElement, rolePicker)
  const cameraControls = new CameraControls(gameScene.camera, gameScene.renderer.domElement)

  // Start the game view polling service
  const poller = new GameViewPoller(gameId, (view) => {
    // Capture alive snapshot BEFORE applying the new view (used for diff below)
    const prevAlive = [...gameState.previousAlive]
    const prevPhase = gameState.phase

    gameState.applyGameView(view)

    // Detect alive → dead transitions and show elimination announcement
    const newAlive = gameState.playerAlive
    for (let i = 0; i < newAlive.length; i++) {
      if (prevAlive[i] === true && newAlive[i] === false) {
        const nickname = gameState.playerNicknames.get(i) ?? `Player ${i}`
        const isNightTransition = prevPhase === 'NIGHT' && gameState.phase === 'DAY'
        const message = isNightTransition
          ? `A player was killed in the night…`
          : `${nickname} was eliminated by vote!`
        showAnnouncement(message)
        break // one announcement per poll cycle is enough
      }
    }

    // Re-fetch nicknames whenever we have fewer names than expected players
    if (gameState.playerNicknames.size < view.playerCount) {
      fetchGamePlayers(gameId).then((r) => {
        let changed = false
        r.players.forEach((p, index) => {
          const mapKey = p.playerId ?? index
          if (gameState.playerNicknames.get(mapKey) !== p.nickname) {
            gameState.playerNicknames.set(mapKey, p.nickname)
            changed = true
          }
        })
        if (changed) {
          gameState.notify()
        }
      }).catch(() => { /* best-effort */ })
    }
  }, 3000)
  poller.start()

  // Start vote status poller
  const votePoller = new VoteStatusPoller(
    gameId,
    () => ({ round: gameState.round, phase: gameState.phase }),
  )
  votePoller.start()

  // Animation Loop
  const clock = new THREE.Clock()

  function animate(): void {
    requestAnimationFrame(animate)
    const delta = clock.getDelta()

    cameraControls.update(delta)
    gameScene.updateEnvironment(delta)
    playerEntities.updateSpeech(delta, clock.elapsedTime)

    gameScene.renderer.render(gameScene.scene, gameScene.camera)
  }

  animate()

  return { hudManager, chatManager, playerListManager, rolePicker, playerEntities, poller, votePoller }
}

// Show lobby first; boot the game scene only after the player has joined.
const lobbyScreen = new LobbyScreen()
lobbyScreen.show()

let activeManagers: GameManagers | null = null

lobbyScreen.onJoined = (gameId: number, gameStarted: boolean, publicKeyHex: string, nickname: string) => {
  if (activeManagers) {
    destroyGame(activeManagers)
    activeManagers = null
  }

  gameState.lobbyGameId = gameId
  gameState.playerEvmAddress = evmWallet.getAddress()
  gameState.playerNickname = nickname
  lobbyScreen.hide()

  bootGame().then((managers) => {
    activeManagers = managers

    managers.chatManager.connect(gameId, publicKeyHex, nickname)
    managers.chatManager.onMessage = (nick, text) => {
      managers.playerEntities.showMessageForPlayer(nick, text)
    }

    gameMaster._bind(managers.playerEntities)
    ;(window as unknown as { gamemaster: typeof gameMaster }).gamemaster = gameMaster

    const bundle = gameState.playerBundle
    if (bundle?.role !== undefined) {
      const player = gameState.players[bundle.playerId]
      if (player) {
        managers.playerEntities.setPlayerRole(player, roleNumberToRole(bundle.role))
      }

      // Werewolves get access to the private werewolf channel
      if (bundle.role === 1) {
        const werewolfPanel = document.querySelector<HTMLElement>('#werewolfChatPanel')
        if (werewolfPanel) werewolfPanel.classList.remove('hidden')

        const werewolfChatManager = new ChatManager({
          messagesBox: '#werewolfMessagesBox',
          chatForm: '#werewolfChatForm',
          chatInput: '#werewolfChatInput',
        })
        werewolfChatManager.connect(gameId, publicKeyHex, nickname, 'werewolf')
        managers.werewolfChatManager = werewolfChatManager
      }
    }

    if (gameStarted) {
      gameState.setGameStarted()
    }
  }).catch((err) => {
    console.error('[bootGame] Failed to start game:', err)
  })
}
