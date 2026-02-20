import * as THREE from 'three'

export function createSeerMesh(): THREE.Group {
  const group = new THREE.Group()

  const matRobe = new THREE.MeshStandardMaterial({ color: 0x4b0082, roughness: 1.0 })
  const matSkin = new THREE.MeshStandardMaterial({ color: 0xeebb99, roughness: 0.5 })
  const matGem = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x004444 })
  const matEyes = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 })

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 0.7, 8), matRobe)
  torso.position.y = 1.6
  torso.castShadow = true
  group.add(torso)

  const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.6, 8, 1, true), matRobe)
  skirt.position.y = -0.4
  skirt.rotation.z = Math.PI
  torso.add(skirt)

  const headGroup = new THREE.Group()
  headGroup.position.y = 0.5
  torso.add(headGroup)

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.45), matSkin)
  head.position.y = 0.3
  head.position.z = 0.01
  headGroup.add(head)

  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 0.55), matRobe)
  hood.position.y = 0.3
  hood.position.z = -0.05
  headGroup.add(hood)

  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.03), matEyes)
  eye.position.set(-0.11, 0.06, 0.24)
  head.add(eye)
  const rEye = eye.clone()
  rEye.position.x = 0.11
  head.add(rEye)

  const gem = new THREE.Mesh(new THREE.DodecahedronGeometry(0.08), matGem)
  gem.position.set(0, 0.35, 0.25)
  head.add(gem)

  function createArm(isLeft: boolean): THREE.Group {
    const shoulder = new THREE.Group()
    shoulder.position.set(isLeft ? -0.38 : 0.38, 0.25, 0)

    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.12), matSkin)
    arm.position.y = -0.25
    shoulder.add(arm)

    const sleeve = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 8), matRobe)
    sleeve.position.y = -0.15
    shoulder.add(sleeve)

    return shoulder
  }

  const leftArm = createArm(true)
  const rightArm = createArm(false)
  torso.add(leftArm)
  torso.add(rightArm)

  function createLeg(isLeft: boolean): THREE.Group {
    const hip = new THREE.Group()
    hip.position.set(isLeft ? -0.15 : 0.15, -0.35, 0)
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.6, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x222222 })
    )
    leg.position.y = -0.3
    hip.add(leg)
    return hip
  }

  const leftLeg = createLeg(true)
  const rightLeg = createLeg(false)
  torso.add(leftLeg)
  torso.add(rightLeg)

  group.userData = { torso, head: headGroup, leftArm, rightArm, leftLeg, rightLeg }
  return group
}
