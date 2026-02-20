import * as THREE from 'three'
import { createRoom } from '../models/sceneModel'
import { createTable, createWoodMaterials } from '../models/tableModel'
import { createBookshelf, createFloorDecorations, createTableDecorations, updateDecorations, createPainting } from '../models/decorationsModel'
import { gameState } from '../state/gameState'

export class GameScene {
  public scene: THREE.Scene
  public camera: THREE.PerspectiveCamera
  public renderer: THREE.WebGLRenderer
  public table: THREE.Group
  
  private sceneRoot: HTMLDivElement
  private windowSky: THREE.Mesh | null = null
  private ambient: THREE.AmbientLight
  private moonLight: THREE.DirectionalLight
  private tableSpot: THREE.SpotLight
  private windowSun: THREE.SpotLight
  private moon!: THREE.Mesh
  
  private sceneNightColor = new THREE.Color(0x0a1020)
  private sceneDayColor = new THREE.Color(0xa7c4ea)
  private fogNightColor = new THREE.Color(0x0a1020)
  private fogDayColor = new THREE.Color(0xc8ddf4)
    private windowNightColor = new THREE.Color(0x0a1020)
    private windowDayColor = new THREE.Color(0xa7c4ea)
  private moonlightNightColor = new THREE.Color(0x88aaff)
  private moonlightDayColor = new THREE.Color(0xfff4db)
  private ambientNightColor = new THREE.Color(0x4b5875)
  private ambientDayColor = new THREE.Color(0xa2b7d9)
  private colorScratch = new THREE.Color()

  private environmentMix = 0

  constructor() {
    this.sceneRoot = document.querySelector<HTMLDivElement>('#sceneRoot')!
    
    this.scene = new THREE.Scene()
    this.scene.background = this.sceneNightColor.clone()
    this.scene.fog = new THREE.Fog(this.fogNightColor.clone(), 12, 34)

    this.camera = new THREE.PerspectiveCamera(
      52,
      this.sceneRoot.clientWidth / this.sceneRoot.clientHeight,
      0.1,
      100
    )
    this.camera.position.set(0, 6, 9.2)

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setSize(this.sceneRoot.clientWidth, this.sceneRoot.clientHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.sceneRoot.appendChild(this.renderer.domElement)

    this.ambient = new THREE.AmbientLight(0x4b5875, 0.6)
    this.scene.add(this.ambient)

    this.moonLight = new THREE.DirectionalLight(0x88aaff, 1.1)
    this.moonLight.position.set(0, 6.5, -12.5)
    this.moonLight.target.position.set(0, 2, 0)
    this.moonLight.castShadow = true
    this.moonLight.shadow.mapSize.width = 1024
    this.moonLight.shadow.mapSize.height = 1024
    this.moonLight.shadow.camera.left = -12
    this.moonLight.shadow.camera.right = 12
    this.moonLight.shadow.camera.top = 12
    this.moonLight.shadow.camera.bottom = -12
    this.moonLight.shadow.camera.near = 0.1
    this.moonLight.shadow.camera.far = 50
    this.scene.add(this.moonLight)

    this.tableSpot = new THREE.SpotLight(0xffe6bf, 1.6, 20, Math.PI / 6, 0.3, 1)
    this.tableSpot.position.set(0, 7, 2)
    this.tableSpot.target.position.set(0, 1.2, 0)
    this.tableSpot.castShadow = true
    this.scene.add(this.tableSpot)
    this.scene.add(this.tableSpot.target)

    this.windowSun = new THREE.SpotLight(0xfff2cc, 0, 24, Math.PI / 7, 0.48, 1.1)
    this.windowSun.position.set(0, 5.6, -12.5)
    this.windowSun.target.position.set(0, 1.8, -5)
    this.windowSun.castShadow = true
    this.scene.add(this.windowSun)
    this.scene.add(this.windowSun.target)

    const moonGeo = new THREE.SphereGeometry(1.2, 32, 32)
    const moonMat = new THREE.MeshBasicMaterial({ color: 0xfff4db, fog: false, transparent: true })
    this.moon = new THREE.Mesh(moonGeo, moonMat)
    this.moon.position.set(-2.5, 7.5, -28)
    this.scene.add(this.moon)

    const { floorMaterial, tableMaterial } = createWoodMaterials()
    const roomData = createRoom({ floorMaterial, windowNightColor: this.windowNightColor })
    this.windowSky = roomData.windowSky
    this.scene.add(roomData.room)
    
    this.table = createTable(tableMaterial)
    this.scene.add(this.table)

    const bookshelf = createBookshelf()
    bookshelf.position.set(3, 0, -10  );
    
    bookshelf.rotation.y = Math.PI / 1
    this.scene.add(bookshelf)

    // Back wall: x ∈ [-12, 12], y ∈ [0, 10], z = -11.9. Window at (0, 5.5), frame 5×3.6 → avoid x ∈ [-2.7, 2.7], y ∈ [3.5, 7.5]
    const BACK_Z = -11.9
    const WALL_X_MIN = -11.2
    const WALL_X_MAX = 11.2
    const WALL_Y_MIN = 1.5
    const WALL_Y_MAX = 8.5
    const WINDOW_X_MIN = -2.7
    const WINDOW_X_MAX = 2.7
    const WINDOW_Y_MIN = 3.5
    const WINDOW_Y_MAX = 7.5
    const SIZE_MIN = 1.2
    const SIZE_MAX = 2.4
    const GAP = 0.25

    const overlapsWindow = (cx: number, cy: number, half: number) =>
      cx - half < WINDOW_X_MAX + GAP && cx + half > WINDOW_X_MIN - GAP &&
      cy - half < WINDOW_Y_MAX + GAP && cy + half > WINDOW_Y_MIN - GAP

    const overlapsPainting = (cx: number, cy: number, half: number, placed: { x: number; y: number; half: number }[]) =>
      placed.some(p => cx - half < p.x + p.half + GAP && cx + half > p.x - p.half - GAP && cy - half < p.y + p.half + GAP && cy + half > p.y - p.half - GAP)

    const inWall = (cx: number, cy: number, half: number) =>
      cx - half >= WALL_X_MIN && cx + half <= WALL_X_MAX && cy - half >= WALL_Y_MIN && cy + half <= WALL_Y_MAX

    const paintingConfigs = [
      { url: '/paint1.png', frame: 0x1e120b, canvas: 0x1a2430 },
      { url: '/paint2.png', frame: 0x2e1a0f, canvas: 0x221a11 },
      { url: '/paint3.png', frame: 0x22110a, canvas: 0x332a24 },
      { url: '/paint4.png', frame: 0x3d2314, canvas: 0x111e22 },
    ]
    const placed: { x: number; y: number; half: number }[] = []

    for (const config of paintingConfigs) {
      let cx: number, cy: number, size: number, half: number
      let attempts = 0
      do {
        size = SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN)
        half = size / 2
        cx = WALL_X_MIN + half + Math.random() * (WALL_X_MAX - WALL_X_MIN - size)
        cy = WALL_Y_MIN + half + Math.random() * (WALL_Y_MAX - WALL_Y_MIN - size)
        attempts++
      } while (attempts < 200 && (overlapsWindow(cx, cy, half) || overlapsPainting(cx, cy, half, placed) || !inWall(cx, cy, half)))

      placed.push({ x: cx, y: cy, half })
      const painting = createPainting(size, size, config.url, config.frame, config.canvas)
      painting.position.set(cx, cy, BACK_Z)
      this.scene.add(painting)
    }

    this.scene.add(createFloorDecorations())
    this.scene.add(createTableDecorations())

    this.initResizeHandling()
  }

  private initResizeHandling() {
    const onResize = () => {
      const width = this.sceneRoot.clientWidth
      const height = this.sceneRoot.clientHeight
      if (width <= 0 || height <= 0) return
      this.renderer.setPixelRatio(window.devicePixelRatio)
      this.camera.aspect = width / height
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(width, height, false)
      this.renderer.render(this.scene, this.camera)
    }

    window.addEventListener('resize', onResize)
    const observer = new ResizeObserver(onResize)
    observer.observe(this.sceneRoot)
    onResize()
  }

  public updateEnvironment(delta: number): void {
    this.environmentMix = THREE.MathUtils.lerp(
      this.environmentMix,
      gameState.targetEnvironmentMix,
      Math.min(1, delta * 1.7)
    )

    this.colorScratch.copy(this.sceneNightColor).lerp(this.sceneDayColor, this.environmentMix)
    ;(this.scene.background as THREE.Color).copy(this.colorScratch)

    this.colorScratch.copy(this.fogNightColor).lerp(this.fogDayColor, this.environmentMix)
    ;(this.scene.fog as THREE.Fog).color.copy(this.colorScratch)

    this.colorScratch.copy(this.ambientNightColor).lerp(this.ambientDayColor, this.environmentMix)
    this.ambient.color.copy(this.colorScratch)
    this.ambient.intensity = THREE.MathUtils.lerp(0.58, 0.64, this.environmentMix)

    this.colorScratch.copy(this.moonlightNightColor).lerp(this.moonlightDayColor, this.environmentMix)
    this.moonLight.color.copy(this.colorScratch)
    this.moonLight.intensity = THREE.MathUtils.lerp(1.05, 0.72, this.environmentMix)

    this.tableSpot.intensity = THREE.MathUtils.lerp(1.6, 0.8, this.environmentMix)
    this.windowSun.intensity = THREE.MathUtils.lerp(0.0, 1.55, this.environmentMix)

    ;(this.moon.material as THREE.MeshBasicMaterial).opacity = 1 - this.environmentMix

    if (this.windowSky) {
      this.colorScratch.copy(this.windowNightColor).lerp(this.windowDayColor, this.environmentMix)
      ;(this.windowSky.material as THREE.MeshBasicMaterial).color.copy(this.colorScratch)
    }

    updateDecorations(performance.now() / 1000, this.environmentMix)
  }
}
