import * as THREE from 'three'
import { DEFAULT_AVATAR_SELECTION, encodeAppearance, type AvatarSelection, appearanceToPlayerConfig } from '../avatarAppearance'
import { createPlayerMesh } from '../models/playerModel'

function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    mesh.geometry?.dispose?.()

    const material = mesh.material
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose())
    } else {
      material?.dispose?.()
    }
  })
}

export class AvatarPreview {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100)
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  private readonly stage = new THREE.Group()
  private readonly pivot = new THREE.Group()

  private container: HTMLElement | null = null
  private model: THREE.Object3D | null = null
  private resizeObserver: ResizeObserver | null = null
  private animationFrame: number | null = null

  constructor(initialSelection: AvatarSelection = DEFAULT_AVATAR_SELECTION) {
    this.camera.position.set(0, 1.8, 6)
    this.camera.lookAt(0, 1.6, 0)

    this.renderer.setClearColor(0x000000, 0)
    this.renderer.shadowMap.enabled = false

    const ambient = new THREE.AmbientLight(0xffffff, 1.8)
    const keyLight = new THREE.DirectionalLight(0xe6efff, 2.4)
    keyLight.position.set(4, 8, 5)
    const fillLight = new THREE.DirectionalLight(0xbfd6ff, 1.25)
    fillLight.position.set(-3, 4, 6)

    this.scene.add(ambient, keyLight, fillLight)

    this.stage.position.y = -1.25
    this.pivot.rotation.y = -0.35
    this.stage.add(this.pivot)
    this.scene.add(this.stage)

    this.setSelection(initialSelection)
  }

  mount(container: HTMLElement): void {
    this.container = container
    this.renderer.domElement.className = 'avatar-preview-canvas'
    this.container.replaceChildren(this.renderer.domElement)
    this.resize()

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.container)

    const animate = () => {
      this.animationFrame = requestAnimationFrame(animate)
      this.pivot.rotation.y += 0.01
      this.renderer.render(this.scene, this.camera)
    }

    animate()
  }

  setSelection(selection: AvatarSelection): void {
    if (this.model) {
      this.pivot.remove(this.model)
      disposeObject3D(this.model)
    }

    const config = appearanceToPlayerConfig(encodeAppearance(selection), 'Preview')
    this.model = createPlayerMesh(config)
    this.pivot.add(this.model)

    if (this.container) {
      this.renderer.render(this.scene, this.camera)
    }
  }

  /**
   * Pauses the render loop and disconnects the ResizeObserver without
   * disposing the WebGL renderer. Call this when the avatar preview is
   * temporarily hidden (e.g. transitioning to the game scene) so that
   * `mount()` can restart it later without needing a full recreation.
   */
  stop(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame)
      this.animationFrame = null
    }

    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.container = null
  }

  /**
   * Fully tears down the preview, releasing all GPU resources. Use this
   * when the avatar preview will never be shown again.
   */
  destroy(): void {
    this.stop()

    if (this.model) {
      this.pivot.remove(this.model)
      disposeObject3D(this.model)
      this.model = null
    }

    this.renderer.dispose()
  }

  private resize(): void {
    if (!this.container) return

    const width = this.container.clientWidth || 240
    const height = this.container.clientHeight || 280
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(width, height, false)
  }
}
