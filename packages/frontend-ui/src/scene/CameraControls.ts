import * as THREE from 'three'
import type { GameScene } from './GameScene'

export class CameraControls {
  private camera: THREE.PerspectiveCamera
  private domElement: HTMLElement

  private cameraEdgePan = new THREE.Vector2(0, 0)
  private readonly EDGE_PAN_THRESHOLD = 0.08
  private readonly EDGE_PAN_SPEED = 1.5
  private readonly CAMERA_BOUNDS = {
    xMin: -3.5,
    xMax: 3.5,
    zMin: 7.5,
    zMax: 11.5
  }
  private readonly cameraTarget = new THREE.Vector3(0, 2.1, 0)

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera
    this.domElement = domElement
    this.camera.lookAt(this.cameraTarget)
    this.initEventListeners()
  }

  private initEventListeners() {
    this.domElement.addEventListener('pointermove', (event: PointerEvent) => {
      const rect = this.domElement.getBoundingClientRect()
      const localX = event.clientX - rect.left
      const localY = event.clientY - rect.top

      if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) {
        this.cameraEdgePan.set(0, 0)
        return
      }

      const nx = localX / rect.width
      const ny = localY / rect.height

      let vx = 0
      let vz = 0

      if (nx < this.EDGE_PAN_THRESHOLD) {
        vx = -1
      } else if (nx > 1 - this.EDGE_PAN_THRESHOLD) {
        vx = 1
      }

      if (ny < this.EDGE_PAN_THRESHOLD) {
        vz = 1
      } else if (ny > 1 - this.EDGE_PAN_THRESHOLD) {
        vz = -1
      }

      if (vx === 0 && vz === 0) {
        this.cameraEdgePan.set(0, 0)
      } else {
        this.cameraEdgePan.set(vx, vz).normalize()
      }
    })

    this.domElement.addEventListener('pointerleave', () => {
      this.cameraEdgePan.set(0, 0)
    })
  }

  public update(delta: number): void {
    if (this.cameraEdgePan.lengthSq() > 0) {
      const moveX = this.cameraEdgePan.x * this.EDGE_PAN_SPEED * delta
      const moveZ = this.cameraEdgePan.y * this.EDGE_PAN_SPEED * delta
      this.camera.position.x = THREE.MathUtils.clamp(
        this.camera.position.x + moveX,
        this.CAMERA_BOUNDS.xMin,
        this.CAMERA_BOUNDS.xMax
      )
      this.camera.position.z = THREE.MathUtils.clamp(
        this.camera.position.z + moveZ,
        this.CAMERA_BOUNDS.zMin,
        this.CAMERA_BOUNDS.zMax
      )
      this.camera.lookAt(this.cameraTarget)
    }
  }
}
