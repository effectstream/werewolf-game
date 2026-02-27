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
import { gameState } from './state/gameState'
import { evmWallet } from './services/evmWallet'
import { fetchGameView } from './services/lobbyApi'
import { GameViewPoller } from './services/gameViewPoller'

interface GameManagers {
  hudManager: HUDManager
  chatManager: ChatManager
  playerListManager: PlayerListManager
  rolePicker: RolePicker
  playerEntities: PlayerEntities
  poller: GameViewPoller
}

function destroyGame(managers: GameManagers): void {
  managers.hudManager.destroy()
  managers.chatManager.destroy()
  managers.playerListManager.destroy()
  managers.rolePicker.destroy()
  managers.playerEntities.destroy()
  managers.poller.stop()
}

async function bootGame(): Promise<GameManagers> {
  const gameId = gameState.lobbyGameId!

  // Fetch initial game view to get the player count
  let initialPlayerCount = 8
  try {
    const initialView = await fetchGameView(gameId)
    gameState.applyGameView(initialView)
    initialPlayerCount = initialView.playerCount || 8
  } catch (err) {
    console.warn('[bootGame] Failed to fetch initial game view, using fallback count:', err)
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
    gameState.applyGameView(view)
  }, 3000)
  poller.start()

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

  return { hudManager, chatManager, playerListManager, rolePicker, playerEntities, poller }
}

// Show lobby first; boot the game scene only after the player has joined.
const lobbyScreen = new LobbyScreen()
lobbyScreen.show()

let activeManagers: GameManagers | null = null

lobbyScreen.onJoined = (gameId: number, gameStarted: boolean) => {
  if (activeManagers) {
    destroyGame(activeManagers)
    activeManagers = null
  }

  gameState.lobbyGameId = gameId
  gameState.playerEvmAddress = evmWallet.getAddress()
  lobbyScreen.hide()

  bootGame().then((managers) => {
    activeManagers = managers
    if (gameStarted) {
      gameState.setGameStarted()
    }
  }).catch((err) => {
    console.error('[bootGame] Failed to start game:', err)
  })
}
