import * as THREE from 'three'
import { PlayerConfig } from './PlayerConfigInterface'

function addHairFromConfig(headGroup: THREE.Mesh, colorMat: THREE.Material, config: PlayerConfig): void {
  const hair = new THREE.Mesh(
    new THREE.BoxGeometry(config.hairWidth, config.hairHeight, config.hairDepth),
    colorMat
  )
  hair.position.y = 0.275 + config.hairHeight / 2
  hair.castShadow = true
  headGroup.add(hair)

  if (config.hasBun) {
    const bun = new THREE.Mesh(
      new THREE.BoxGeometry(config.bunSize, config.bunSize, config.bunSize),
      colorMat
    )
    bun.position.set(0, 0.2, -0.25 - config.bunSize / 2)
    headGroup.add(bun)
  }
}

export function createDoctorMesh(config: PlayerConfig): THREE.Group {
  const group = new THREE.Group()

  const matCoat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 })
  const matScrubs = new THREE.MeshStandardMaterial({ color: 0x66ccff, roughness: 0.8 })
  const matSkin = new THREE.MeshStandardMaterial({ color: config.skin, roughness: 0.5 })
  const matHair = new THREE.MeshStandardMaterial({ color: config.hair, roughness: 0.7 })
  const matSilver = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8, roughness: 0.2 })
  const matEyes = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 })

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.7, 8), matCoat)
  torso.position.y = 1.6
  torso.castShadow = true
  group.add(torso)

  const coatBottom = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.4, 0.4, 8), matCoat)
  coatBottom.position.y = -0.5
  torso.add(coatBottom)

  const headGroup = new THREE.Group()
  headGroup.position.y = 0.5
  torso.add(headGroup)

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.5), matSkin)
  head.position.y = 0.35
  headGroup.add(head)

  // FIX: Swapped to a BoxGeometry sized 0.52 (just wider than the 0.5 head)
  const mirrorStrap = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.04, 0.52), matSilver)
  mirrorStrap.position.y = 0.18 
  head.add(mirrorStrap)

  // FIX: Moved Z to 0.27 so the back of the disc touches the flat face of the strap
  const mirrorDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 16), matSilver)
  mirrorDisc.rotation.x = Math.PI / 2
  mirrorDisc.position.set(0, 0.18, 0.27) 
  head.add(mirrorDisc)

  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.03), matEyes)
  eye.position.set(-0.13, 0.06, 0.27)
  head.add(eye)
  const rEye = eye.clone()
  rEye.position.x = 0.13
  head.add(rEye)

  addHairFromConfig(head as any, matHair, config)

  function createArm(isLeft: boolean): THREE.Group {
    const shoulder = new THREE.Group()
    shoulder.position.set(isLeft ? -0.42 : 0.42, 0.25, 0)

    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.6, 0.18), matCoat)
    arm.position.y = -0.25
    shoulder.add(arm)

    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15), matSkin)
    hand.position.y = -0.38
    arm.add(hand)

    return shoulder
  }

  const leftArm = createArm(true)
  const rightArm = createArm(false)
  torso.add(leftArm)
  torso.add(rightArm)

  function createLeg(isLeft: boolean): THREE.Group {
    const hip = new THREE.Group()
    hip.position.set(isLeft ? -0.15 : 0.15, -0.35, 0)

    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.6, 0.18), matScrubs)
    leg.position.y = -0.3
    hip.add(leg)

    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.28), matCoat)
    shoe.position.set(0, -0.32, 0.05)
    leg.add(shoe)
    return hip
  }

  const leftLeg = createLeg(true)
  const rightLeg = createLeg(false)
  torso.add(leftLeg)
  torso.add(rightLeg)

  group.userData = { torso, head: headGroup, leftArm, rightArm, leftLeg, rightLeg }
  return group
}