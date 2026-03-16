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
