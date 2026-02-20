import * as THREE from 'three'
import { PlayerConfig } from './PlayerConfigInterface'

export function createPlayerMesh(config: PlayerConfig): THREE.Group {
  const group = new THREE.Group()

  // --- Materials ---
  const matCloth = new THREE.MeshStandardMaterial({ color: config.cloth, roughness: 0.8 })
  const matSkin = new THREE.MeshStandardMaterial({ color: config.skin, roughness: 0.5 })
  const matHair = new THREE.MeshStandardMaterial({ color: config.hair, roughness: 0.9 })
  const matDark = new THREE.MeshStandardMaterial({ color: 0x333333 })
  const matPants = new THREE.MeshStandardMaterial({ color: 0x252836 })

  // --- Torso ---
  const torsoGeo = new THREE.CylinderGeometry(0.35, 0.30, 0.7, 8)
  const torso = new THREE.Mesh(torsoGeo, matCloth)
  torso.position.y = 1.6
  torso.castShadow = true
  torso.receiveShadow = true
  group.add(torso)

  // --- Head Group ---
  const headGroup = new THREE.Group()
  headGroup.position.y = 0.45
  torso.add(headGroup)

  // Head Mesh (The Skull)
  const headGeo = new THREE.BoxGeometry(0.5, 0.55, 0.5)
  const head = new THREE.Mesh(headGeo, matSkin)
  head.position.y = 0.35
  head.castShadow = true
  head.receiveShadow = true
  headGroup.add(head)

  // --- Hair (parameters provided by PlayerConfig) ---
  const hairGeo = new THREE.BoxGeometry(config.hairWidth, config.hairHeight, config.hairDepth)
  const hairMesh = new THREE.Mesh(hairGeo, matHair)
  hairMesh.position.y = 0.275 + config.hairHeight / 2
  hairMesh.castShadow = true
  hairMesh.receiveShadow = true
  head.add(hairMesh)

  if (config.hasBun) {
    const bunGeo = new THREE.BoxGeometry(config.bunSize, config.bunSize, config.bunSize)
    const bun = new THREE.Mesh(bunGeo, matHair)
    bun.position.set(0, 0.2, -0.25 - config.bunSize / 2)
    head.add(bun)
  }

  // --- Face (Eyes) ---
  const eyeGeo = new THREE.BoxGeometry(0.1, 0.1, 0.05)
  const leftEye = new THREE.Mesh(eyeGeo, matDark)
  leftEye.position.set(-0.12, 0.05, 0.26)
  head.add(leftEye)

  const rightEye = leftEye.clone()
  rightEye.position.x = 0.12
  head.add(rightEye)

  // --- Arms ---
  function createArm(isLeft: boolean): THREE.Group {
    const shoulder = new THREE.Group()
    const xOffset = isLeft ? -0.42 : 0.42
    shoulder.position.set(xOffset, 0.25, 0)

    const armGeo = new THREE.BoxGeometry(0.18, 0.6, 0.18)
    const arm = new THREE.Mesh(armGeo, matSkin)
    arm.position.y = -0.25
    arm.castShadow = true
    arm.receiveShadow = true
    shoulder.add(arm)

    const sleeveGeo = new THREE.BoxGeometry(0.2, 0.25, 0.2)
    const sleeve = new THREE.Mesh(sleeveGeo, matCloth)
    sleeve.position.y = 0.18
    arm.add(sleeve)

    return shoulder
  }

  const leftArm = createArm(true)
  torso.add(leftArm)
  const rightArm = createArm(false)
  torso.add(rightArm)

  // --- Legs ---
  function createLeg(isLeft: boolean): THREE.Group {
    const hip = new THREE.Group()
    const xOffset = isLeft ? -0.15 : 0.15
    hip.position.set(xOffset, -0.35, 0)

    const legGeo = new THREE.BoxGeometry(0.2, 0.6, 0.2)
    const leg = new THREE.Mesh(legGeo, matPants)
    leg.position.y = -0.3
    leg.castShadow = true
    leg.receiveShadow = true
    hip.add(leg)

    const shoeGeo = new THREE.BoxGeometry(0.22, 0.15, 0.3)
    const shoe = new THREE.Mesh(shoeGeo, matDark)
    shoe.position.set(0, -0.3, 0.05)
    leg.add(shoe)

    return hip
  }

  const leftLeg = createLeg(true)
  torso.add(leftLeg)
  const rightLeg = createLeg(false)
  torso.add(rightLeg)

  group.userData = {
    torso,
    head: headGroup,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg
  }

  return group
}
