import * as THREE from 'three'

export function createWerewolfMesh(): THREE.Group {
  const group = new THREE.Group()

  const matFur = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 })
  const matShorts = new THREE.MeshStandardMaterial({ color: 0x3d4c53, roughness: 0.8 })
  const matClaws = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 })
  const matEyes = new THREE.MeshStandardMaterial({ color: 0xff3300, emissive: 0x550000 })

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.35, 0.7, 8), matFur)
  torso.position.y = 1.6
  torso.castShadow = true
  group.add(torso)

  const headGroup = new THREE.Group()
  headGroup.position.y = 0.5
  torso.add(headGroup)

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.6), matFur)
  head.position.y = 0.3
  head.castShadow = true
  headGroup.add(head)

  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.2, 0.25), matFur)
  snout.position.set(0, -0.05, 0.35)
  head.add(snout)

  const earGeo = new THREE.ConeGeometry(0.1, 0.25, 4)
  const leftEar = new THREE.Mesh(earGeo, matFur)
  leftEar.position.set(-0.2, 0.35, 0)
  leftEar.rotation.z = 0.3
  head.add(leftEar)

  const rightEar = leftEar.clone()
  rightEar.position.set(0.2, 0.35, 0)
  rightEar.rotation.z = -0.3
  head.add(rightEar)

  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.05), matEyes)
  eye.position.set(-0.12, 0.05, 0.32)
  head.add(eye)
  const rEye = eye.clone()
  rEye.position.x = 0.12
  head.add(rEye)

  const tailGroup = new THREE.Group()
  tailGroup.position.set(0, -0.3, -0.2)
  torso.add(tailGroup)
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.6), matFur)
  tail.position.z = -0.3
  tail.rotation.x = -0.5
  tailGroup.add(tail)

  function createArm(isLeft: boolean): THREE.Group {
    const shoulder = new THREE.Group()
    shoulder.position.set(isLeft ? -0.48 : 0.48, 0.25, 0)

    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.7, 0.22), matFur)
    arm.position.y = -0.3
    arm.castShadow = true
    shoulder.add(arm)

    const claw = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.1), matClaws)
    claw.position.set(0, -0.35, 0.1)
    arm.add(claw)
    return shoulder
  }

  const leftArm = createArm(true)
  const rightArm = createArm(false)
  torso.add(leftArm)
  torso.add(rightArm)

  function createLeg(isLeft: boolean): THREE.Group {
    const hip = new THREE.Group()
    hip.position.set(isLeft ? -0.18 : 0.18, -0.35, 0)

    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.6, 0.22), matShorts)
    leg.position.y = -0.3
    hip.add(leg)

    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.15, 0.35), matFur)
    foot.position.set(0, -0.3, 0.05)
    leg.add(foot)
    return hip
  }

  const leftLeg = createLeg(true)
  const rightLeg = createLeg(false)
  torso.add(leftLeg)
  torso.add(rightLeg)

  group.userData = { torso, head: headGroup, leftArm, rightArm, leftLeg, rightLeg, tail: tailGroup }
  return group
}
