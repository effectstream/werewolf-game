import * as THREE from 'three'

export interface CreateRoomParams {
  floorMaterial: THREE.Material
  windowNightColor: THREE.Color
}

export interface CreateRoomResult {
  room: THREE.Group
  windowSky: THREE.Mesh
}

export function createRoom({ floorMaterial, windowNightColor }: CreateRoomParams): CreateRoomResult {
  const room = new THREE.Group()
  const roomMaterial = new THREE.MeshStandardMaterial({ color: 0x1a2133, roughness: 0.92 })

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), floorMaterial)
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  room.add(floor)

  const shape = new THREE.Shape()
  shape.moveTo(-12, -5)
  shape.lineTo(12, -5)
  shape.lineTo(12, 5)
  shape.lineTo(-12, 5)
  shape.lineTo(-12, -5)

  const windowHole = new THREE.Path()
  // Window frame is 5x3.6 at y=5.5 (which is +0.5 relative to center 5)
  // center of wall is (0,5), so window center is (0, 0.5) in shape coordinates
  windowHole.moveTo(-2.5, -1.3)
  windowHole.lineTo(2.5, -1.3)
  windowHole.lineTo(2.5, 2.3)
  windowHole.lineTo(-2.5, 2.3)
  windowHole.lineTo(-2.5, -1.3)
  shape.holes.push(windowHole)

  const backWallGeo = new THREE.ShapeGeometry(shape)
  const backWall = new THREE.Mesh(backWallGeo, roomMaterial)
  backWall.position.set(0, 5, -12)
  backWall.receiveShadow = true
  backWall.castShadow = true
  room.add(backWall)

  const wallGeometry = new THREE.PlaneGeometry(24, 10)

  const leftWall = new THREE.Mesh(wallGeometry, roomMaterial)
  leftWall.position.set(-12, 5, 0)
  leftWall.rotation.y = Math.PI / 2
  leftWall.receiveShadow = true
  leftWall.castShadow = true
  room.add(leftWall)

  const rightWall = new THREE.Mesh(wallGeometry, roomMaterial)
  rightWall.position.set(12, 5, 0)
  rightWall.rotation.y = -Math.PI / 2
  rightWall.receiveShadow = true
  rightWall.castShadow = true
  room.add(rightWall)

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 24),
    new THREE.MeshStandardMaterial({ color: 0x0e1422, roughness: 0.9 })
  )
  ceiling.position.y = 10
  ceiling.rotation.x = Math.PI / 2
  ceiling.receiveShadow = true
  ceiling.castShadow = true
  room.add(ceiling)

  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a3656 })
  
  const frameTop = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.2, 0.2), frameMat)
  frameTop.position.set(0, 7.3, -11.93)
  room.add(frameTop)
  
  const frameBottom = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.2, 0.2), frameMat)
  frameBottom.position.set(0, 3.7, -11.93)
  room.add(frameBottom)
  
  const frameLeft = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.8, 0.2), frameMat)
  frameLeft.position.set(-2.5, 5.5, -11.93)
  room.add(frameLeft)
  
  const frameRight = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.8, 0.2), frameMat)
  frameRight.position.set(2.5, 5.5, -11.93)
  room.add(frameRight)

  // We remove windowSky so the actual scene background is visible through the window hole
  const windowSky = null as any

  return { room, windowSky }
}
