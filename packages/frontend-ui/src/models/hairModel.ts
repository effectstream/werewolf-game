import * as THREE from 'three'
import type { PlayerConfig } from './PlayerConfigInterface'

export interface HairRenderInfo {
  topY: number
}

function finalizeMesh(mesh: THREE.Mesh): THREE.Mesh {
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/**
 * The four "spec-driven" hair styles below (baseballCap, topHat, mohawk, jrpg)
 * are authored in a coordinate system where the base head is a unit sphere of
 * radius 1.0 centered at the origin. The actual head in playerModel.ts is a
 * Box(0.5, 0.55, 0.5), so we wrap each spec build in a group and scale it down
 * by HEAD_SCALE so the spec dimensions land on the existing head.
 */
const HEAD_SCALE = 0.27

function buildBaseballCap(hairMaterial: THREE.Material): THREE.Group {
  const group = new THREE.Group()

  // Crown: hemisphere centered at origin, capping the upper half of the head.
  const crown = finalizeMesh(new THREE.Mesh(
    new THREE.SphereGeometry(1.02, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    hairMaterial,
  ))
  group.add(crown)

  // Visor: thin flat slab extending forward (+Z) from the forehead edge,
  // tilted ~10 degrees downward. Pushed well past the front of the dome
  // so it reads clearly as a brim.
  const visor = finalizeMesh(new THREE.Mesh(
    new THREE.BoxGeometry(2.04, 0.05, 1.3),
    hairMaterial,
  ))
  visor.position.set(0, 0.0, 1.05)
  visor.rotation.x = -0.18
  group.add(visor)

  // Top button at the apex.
  const button = finalizeMesh(new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 10, 8),
    hairMaterial,
  ))
  button.position.set(0, 1.02, 0)
  group.add(button)

  return group
}

function buildTopHat(hairMaterial: THREE.Material): THREE.Group {
  const group = new THREE.Group()

  // Brim: wide thin cylinder sitting just above the head's equator.
  const brim = finalizeMesh(new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.5, 0.05, 32),
    hairMaterial,
  ))
  brim.position.set(0, 0.1, 0)
  group.add(brim)

  // Crown body: tall cylinder resting centered on top of the brim.
  const crownHeight = 1.9
  const crown = finalizeMesh(new THREE.Mesh(
    new THREE.CylinderGeometry(1.05, 1.05, crownHeight, 32),
    hairMaterial,
  ))
  crown.position.set(0, 0.1 + 0.025 + crownHeight / 2, 0)
  group.add(crown)

  return group
}

function buildMohawk(hairMaterial: THREE.Material): THREE.Group {
  const group = new THREE.Group()

  // Cones distributed along the Y-Z plane on the surface of the unit sphere.
  // theta is the angle from +Y, positive theta tilts toward +Z (forehead),
  // negative theta tilts toward -Z (back of head).
  const cones: { theta: number, height: number }[] = [
    { theta: Math.PI * 0.33, height: 0.70 },
    { theta: Math.PI * 0.22, height: 1.05 },
    { theta: Math.PI * 0.11, height: 1.50 },
    { theta: 0,              height: 1.80 },
    { theta: -Math.PI * 0.11, height: 1.65 },
    { theta: -Math.PI * 0.22, height: 1.35 },
    { theta: -Math.PI * 0.33, height: 1.00 },
    { theta: -Math.PI * 0.42, height: 0.65 },
  ]

  for (const { theta, height } of cones) {
    const cone = finalizeMesh(new THREE.Mesh(
      new THREE.ConeGeometry(0.15, height, 14),
      hairMaterial,
    ))
    // Blade along the X axis — chunky strip, still flatter than it is tall.
    cone.scale.x = 0.95
    // Sit base on the sphere surface, axis along the outward normal.
    const r = 1 + height / 2
    cone.position.set(0, Math.cos(theta) * r, Math.sin(theta) * r)
    cone.rotation.x = theta
    group.add(cone)
  }

  return group
}

function buildJrpgHair(hairMaterial: THREE.Material): THREE.Group {
  const group = new THREE.Group()

  // Each spec defines a single spike: position is the cone CENTER, rotation
  // (rx, ry, rz) is applied as Euler XYZ. Cones are anchored slightly inside
  // the top/back surface of the head sphere.
  type Spike = {
    radius: number
    height: number
    pos: [number, number, number]
    rot: [number, number, number]
  }

  const spikes: Spike[] = [
    // --- Main spikes: fan outward from the apex in distinct directions ---
    // Convention: rot.x tilts forward(+)/back(-); rot.z tilts toward -X(+)/+X(-).
    // So a LEFT-leaning spike (negative x position) needs rot.z > 0.
    // Sharply back
    { radius: 0.70, height: 2.0, pos: [0.0, 0.95, -0.70], rot: [-0.85, 0, 0] },
    // Strongly leaning LEFT (and a bit back)
    { radius: 0.62, height: 1.85, pos: [-0.55, 1.05, -0.20], rot: [-0.30, 0, 0.95] },
    // Strongly leaning RIGHT (and a bit back)
    { radius: 0.62, height: 1.85, pos: [0.55, 1.05, -0.20], rot: [-0.30, 0, -0.95] },
    // Leaning FORWARD over the head
    { radius: 0.55, height: 1.6, pos: [0.0, 1.10, 0.30], rot: [0.55, 0, 0] },

    // --- Medium spikes flaring sideways past the ears ---
    { radius: 0.40, height: 1.0, pos: [-0.85, 0.55, -0.15], rot: [0, 0, 1.1] },
    { radius: 0.40, height: 1.0, pos: [0.85, 0.55, -0.15], rot: [0, 0, -1.1] },
    { radius: 0.36, height: 0.9, pos: [-0.80, 0.70, -0.45], rot: [-0.2, -0.4, 1.0] },
    { radius: 0.36, height: 0.9, pos: [0.80, 0.70, -0.45], rot: [-0.2, 0.4, -1.0] },

    // --- Secondary back/top filler spikes — diverge in every direction
    // so the top of the head reads as a wild crown rather than a bundle. ---
    // Back-left & back-right (lean back AND outward)
    { radius: 0.32, height: 0.95, pos: [-0.30, 0.95, -0.70], rot: [-0.75, 0, 0.55] },
    { radius: 0.32, height: 0.95, pos: [0.30, 0.95, -0.70], rot: [-0.75, 0, -0.55] },
    // Side-back lower
    { radius: 0.28, height: 0.80, pos: [-0.65, 0.80, -0.50], rot: [-0.40, 0, 0.95] },
    { radius: 0.28, height: 0.80, pos: [0.65, 0.80, -0.50], rot: [-0.40, 0, -0.95] },
    // Forward-top center: shoots up and slightly forward
    { radius: 0.30, height: 0.75, pos: [0.0, 1.15, 0.05], rot: [0.25, 0, 0] },
    // Forward-side fillers leaning out and forward
    { radius: 0.25, height: 0.65, pos: [-0.45, 1.05, 0.15], rot: [0.30, 0, 0.75] },
    { radius: 0.25, height: 0.65, pos: [0.45, 1.05, 0.15], rot: [0.30, 0, -0.75] },

    // --- Jagged bangs: hang as a fringe over the forehead. The cone center
    // sits in front of the head box (spec z ≈ 1.05–1.15, beyond the face),
    // and rot.x ≈ 2.85 flips the cone so the tip points mostly straight
    // down with a slight forward kick. In spec coords this group is offset
    // to head-local y = 0.22, so spec y ≈ -0.20 lands the base near the
    // hairline and the tip drops to roughly eye level in front of the face.
    { radius: 0.26, height: 1.05, pos: [-0.42, -0.20, 1.05], rot: [2.85, -0.1, -0.05] },
    { radius: 0.26, height: 1.05, pos: [0.42, -0.20, 1.05], rot: [2.85, 0.1, 0.05] },
    { radius: 0.22, height: 0.95, pos: [-0.15, -0.10, 1.10], rot: [2.95, -0.05, 0] },
    { radius: 0.22, height: 0.95, pos: [0.15, -0.10, 1.10], rot: [2.95, 0.05, 0] },
  ]

  for (const spike of spikes) {
    const cone = finalizeMesh(new THREE.Mesh(
      new THREE.ConeGeometry(spike.radius, spike.height, 12),
      hairMaterial,
    ))
    cone.position.set(spike.pos[0], spike.pos[1], spike.pos[2])
    cone.rotation.set(spike.rot[0], spike.rot[1], spike.rot[2])
    group.add(cone)
  }

  return group
}

export function addHairFromConfig(
  head: THREE.Object3D,
  hairMaterial: THREE.Material,
  config: Pick<PlayerConfig, 'hairStyle'>,
): HairRenderInfo {
  switch (config.hairStyle) {
    case 'round': {
      const hairCap = finalizeMesh(new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 18, 14),
        hairMaterial,
      ))
      hairCap.scale.set(1, 0.82, 0.95)
      hairCap.position.set(0, 0.33, -0.015)
      head.add(hairCap)
      return { topY: hairCap.position.y + 0.34 * hairCap.scale.y }
    }

    case 'pointy': {
      const hairBase = finalizeMesh(new THREE.Mesh(
        new THREE.SphereGeometry(0.285, 20, 14),
        hairMaterial,
      ))
      hairBase.scale.set(1, 0.58, 0.92)
      hairBase.position.set(0, 0.24, -0.015)
      head.add(hairBase)

      const spikeGeometry = new THREE.ConeGeometry(0.11, 0.34, 18, 2)
      const spikeSpecs = [
        { x: 0, y: 0.52, z: -0.01, rotZ: 0, rotX: 0 },
        { x: -0.13, y: 0.42, z: 0.03, rotZ: 0.28, rotX: -0.08 },
        { x: 0.13, y: 0.42, z: 0.03, rotZ: -0.28, rotX: -0.08 },
        { x: -0.09, y: 0.39, z: -0.12, rotZ: 0.18, rotX: 0.12 },
        { x: 0.09, y: 0.39, z: -0.12, rotZ: -0.18, rotX: 0.12 },
      ] as const

      spikeSpecs.forEach((spec) => {
        const spike = finalizeMesh(new THREE.Mesh(spikeGeometry, hairMaterial))
        spike.position.set(spec.x, spec.y, spec.z)
        spike.rotation.z = spec.rotZ
        spike.rotation.x = spec.rotX
        head.add(spike)
      })

      return { topY: 0.69 }
    }

    case 'ponytail': {
      const hairTop = finalizeMesh(new THREE.Mesh(
        new THREE.SphereGeometry(0.33, 18, 14),
        hairMaterial,
      ))
      hairTop.scale.set(1, 0.8, 0.94)
      hairTop.position.set(0, 0.34, -0.015)
      head.add(hairTop)

      const hairTie = finalizeMesh(new THREE.Mesh(
        new THREE.SphereGeometry(0.075, 10, 10),
        hairMaterial,
      ))
      hairTie.scale.set(1, 0.9, 0.9)
      hairTie.position.set(0, 0.1, -0.245)
      head.add(hairTie)

      const ponytail = finalizeMesh(new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.095, 0.5, 10),
        hairMaterial,
      ))
      ponytail.rotation.x = 0.22
      ponytail.position.set(0, -0.08, -0.315)
      head.add(ponytail)

      return { topY: hairTop.position.y + 0.33 * hairTop.scale.y }
    }

    case 'baseballCap': {
      const cap = buildBaseballCap(hairMaterial)
      cap.scale.setScalar(HEAD_SCALE)
      // Sit the dome's base flush with the top of the head box (y ≈ 0.275),
      // so the cap rests on top of the skull rather than bisecting it.
      cap.position.set(0, 0.27, 0)
      head.add(cap)
      // Top of cap apex (~y=1.07 in spec) projected into head-local space.
      return { topY: cap.position.y + 1.07 * HEAD_SCALE }
    }

    case 'topHat': {
      const hat = buildTopHat(hairMaterial)
      hat.scale.setScalar(HEAD_SCALE)
      // Brim sits just above the head's "equator" (= top of head box).
      hat.position.set(0, 0.27, 0)
      head.add(hat)
      // Top of crown (~y=2.05 in spec) projected into head-local space.
      return { topY: hat.position.y + 2.05 * HEAD_SCALE }
    }

    case 'mohawk': {
      const mohawk = buildMohawk(hairMaterial)
      mohawk.scale.setScalar(HEAD_SCALE)
      mohawk.position.set(0, 0.05, 0)
      head.add(mohawk)
      // Tallest cone tip ~y=1.6 in spec space (1 + 1.2/2 + 0.6 ≈ 1.6).
      return { topY: mohawk.position.y + 1.6 * HEAD_SCALE }
    }

    case 'jrpg': {
      const hair = buildJrpgHair(hairMaterial)
      hair.scale.setScalar(HEAD_SCALE)
      // Anchor the spec sphere above the head box center so spike bases
      // sit on the upper half of the skull instead of around its midline.
      hair.position.set(0, 0.22, 0)
      head.add(hair)
      // Approximate apex of the tallest spike in spec space.
      return { topY: hair.position.y + 1.85 * HEAD_SCALE }
    }

    case 'square':
    default: {
      const hairBlock = finalizeMesh(new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.24, 0.56),
        hairMaterial,
      ))
      hairBlock.position.set(0, 0.395, -0.01)
      head.add(hairBlock)
      return { topY: hairBlock.position.y + 0.12 }
    }
  }
}
