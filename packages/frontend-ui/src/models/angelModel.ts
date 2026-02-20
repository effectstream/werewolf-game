import * as THREE from 'three'
import { PlayerConfig } from './PlayerConfigInterface'

export function createAngelMesh(config: PlayerConfig): THREE.Group {
  const group = new THREE.Group()

  // --- Materials ---
  // Angels always wear white robes (not player cloth color)
  const matRobe = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 })
  const matSkin = new THREE.MeshStandardMaterial({ color: config.skin, roughness: 0.5 })   // Skin matches player
  const matHair = new THREE.MeshStandardMaterial({ color: config.hair, roughness: 0.9 })   // Hair matches player
  
  const matGold = new THREE.MeshStandardMaterial({
    color: 0xffd27f,
    metalness: 0.9,
    roughness: 0.25,
    emissive: 0x332200,
    emissiveIntensity: 0.35
  })
  
  const matWings = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide
  })
  const matEyes = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 })

  // --- Torso & Robe ---
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.75, 8), matRobe)
  torso.position.y = 1.6
  torso.castShadow = true
  group.add(torso)

  const lowerRobe = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.7, 10, 1, true), matRobe)
  lowerRobe.position.y = -0.45
  lowerRobe.rotation.z = Math.PI
  torso.add(lowerRobe)

  // --- Head Group ---
  const headGroup = new THREE.Group()
  headGroup.position.y = 0.52
  torso.add(headGroup)

  // Synced to Player's Head Size
  const headGeo = new THREE.BoxGeometry(0.5, 0.55, 0.5)
  const head = new THREE.Mesh(headGeo, matSkin)
  head.position.y = 0.35
  headGroup.add(head)

  // --- Hair (parameters shared with PlayerConfig) ---
  const hairGeo = new THREE.BoxGeometry(config.hairWidth, config.hairHeight, config.hairDepth)
  const hairMesh = new THREE.Mesh(hairGeo, matHair)
  hairMesh.position.y = 0.275 + config.hairHeight / 2
  head.add(hairMesh)

  if (config.hasBun) {
    const bunGeo = new THREE.BoxGeometry(config.bunSize, config.bunSize, config.bunSize)
    const bun = new THREE.Mesh(bunGeo, matHair)
    bun.position.set(0, 0.2, -0.25 - config.bunSize / 2)
    head.add(bun)
  }

  // --- Halo ---
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.03, 8, 24), matGold)
  // Place the halo clearly above the top of the hair
  const hairTopY = head.position.y + hairMesh.position.y + config.hairHeight / 2
  halo.position.y = hairTopY + 0.12
  halo.rotation.x = Math.PI / 2
  headGroup.add(halo)

  // --- Face (Eyes) ---
  const eyeGeo = new THREE.BoxGeometry(0.1, 0.1, 0.05)
  const leftEye = new THREE.Mesh(eyeGeo, matEyes)
  leftEye.position.set(-0.12, 0.05, 0.26)
  head.add(leftEye)

  const rightEye = leftEye.clone()
  rightEye.position.x = 0.12
  head.add(rightEye)

  // --- Wings ---
  const wingGeo = new THREE.PlaneGeometry(0.9, 1.2)
  const leftWing = new THREE.Mesh(wingGeo, matWings)
  leftWing.position.set(-0.25, 0.3, -0.3)
  leftWing.rotation.y = Math.PI / 6 
  torso.add(leftWing)

  const rightWing = leftWing.clone()
  rightWing.position.set(0.25, 0.3, -0.3)
  rightWing.rotation.y = -Math.PI / 6 
  torso.add(rightWing)

  // --- Arms ---
  function createArm(isLeft: boolean): THREE.Group {
    const shoulder = new THREE.Group()
    shoulder.position.set(isLeft ? -0.4 : 0.4, 0.25, 0)

    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.6, 0.14), matSkin)
    arm.position.y = -0.25
    shoulder.add(arm)

    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.28, 0.2), matRobe)
    sleeve.position.y = 0.08
    arm.add(sleeve)

    return shoulder
  }

  const leftArm = createArm(true)
  const rightArm = createArm(false)
  torso.add(leftArm)
  torso.add(rightArm)

  // --- Legs ---
  function createLeg(isLeft: boolean): THREE.Group {
    const hip = new THREE.Group()
    hip.position.set(isLeft ? -0.15 : 0.15, -0.35, 0.02)
    
    // Updated to use matSkin so the legs match the player's face/arms
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.16), matSkin)
    leg.position.y = -0.28
    hip.add(leg)
    return hip
  }

  const leftLeg = createLeg(true)
  const rightLeg = createLeg(false)
  torso.add(leftLeg)
  torso.add(rightLeg)

  group.userData = { torso, head: headGroup, leftArm, rightArm, leftLeg, rightLeg, leftWing, rightWing }
  return group
}