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

// Bootstrap Layout
initLayout()

// Initialize UI Managers
const hudManager = new HUDManager()
const chatManager = new ChatManager()
const playerListManager = new PlayerListManager()
const rolePicker = new RolePicker()

// Initialize Scene Layer
const gameScene = new GameScene()
const playerEntities = new PlayerEntities(gameScene.scene, chatManager, (count) => {
  if (gameScene.table.userData.updateCardLayout) {
    gameScene.table.userData.updateCardLayout(count)
  }
})

// Wire up events
rolePicker.onRoleSelected = (player, role) => {
  playerEntities.setPlayerRole(player, role)
}
playerListManager.buildPlayerList()

const interactionManager = new InteractionManager(gameScene.camera, gameScene.renderer.domElement, rolePicker)
const cameraControls = new CameraControls(gameScene.camera, gameScene.renderer.domElement)

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
