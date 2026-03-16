import * as THREE from 'three'
import { gameState } from '../state/gameState'
import type { RolePicker } from '../ui/RolePicker'

export class InteractionManager {
  private raycaster = new THREE.Raycaster()
  private pointerNdc = new THREE.Vector2()
  
  private camera: THREE.PerspectiveCamera
  private domElement: HTMLElement
  private rolePicker: RolePicker

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement, rolePicker: RolePicker) {
    this.camera = camera
    this.domElement = domElement
    this.rolePicker = rolePicker
    
    this.initEventListeners()
  }

  private initEventListeners() {
    this.domElement.addEventListener('pointerdown', (event: PointerEvent) => {
      const backdrop = document.querySelector<HTMLDivElement>('#rolePickerBackdrop')
      if (backdrop && !backdrop.classList.contains('hidden')) {
        return
      }

      const rect = this.domElement.getBoundingClientRect()
      this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      this.pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      this.raycaster.setFromCamera(this.pointerNdc, this.camera)

      const pickTargets = gameState.players.map((player) => player.activeModel)
      const intersections = this.raycaster.intersectObjects(pickTargets, true)
      
      const hit = intersections.find((entry) =>
        Number.isInteger((entry.object as THREE.Object3D & { userData: { playerIndex?: number } }).userData.playerIndex)
      )
      
      if (!hit) return
      
      const playerIndex = (hit.object as THREE.Object3D & { userData: { playerIndex?: number } }).userData.playerIndex
      const player = playerIndex !== undefined ? gameState.players[playerIndex] : undefined
      
      if (player) {
        this.rolePicker.open(player)
      }
    })

    this.domElement.addEventListener('pointermove', (event: PointerEvent) => {
      const rect = this.domElement.getBoundingClientRect()
      const localX = event.clientX - rect.left
      const localY = event.clientY - rect.top

      if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) {
        gameState.setHoveredPlayer(null)
        this.domElement.style.cursor = 'default'
        return
      }

      this.pointerNdc.x = (localX / rect.width) * 2 - 1
      this.pointerNdc.y = -(localY / rect.height) * 2 + 1
      this.raycaster.setFromCamera(this.pointerNdc, this.camera)

      const pickTargets = gameState.players.map((player) => player.activeModel)
      const intersections = this.raycaster.intersectObjects(pickTargets, true)
      
      const hit = intersections.find((entry) =>
        Number.isInteger((entry.object as THREE.Object3D & { userData: { playerIndex?: number } }).userData.playerIndex)
      )

      if (!hit) {
        gameState.setHoveredPlayer(null)
        this.domElement.style.cursor = 'default'
        return
      }

      const playerIndex = (hit.object as THREE.Object3D & { userData: { playerIndex?: number } }).userData.playerIndex
      const player = playerIndex !== undefined ? gameState.players[playerIndex] : undefined
      gameState.setHoveredPlayer(player ?? null)
      this.domElement.style.cursor = player ? 'pointer' : 'default'
    })

    this.domElement.addEventListener('pointerleave', () => {
      gameState.setHoveredPlayer(null)
      this.domElement.style.cursor = 'default'
    })
  }
}
