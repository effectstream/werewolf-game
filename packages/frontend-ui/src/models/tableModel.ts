import * as THREE from 'three'

interface WoodMaterialParams {
  scale?: number
  ringFreq?: number
  grainFreq?: number
  colorA: THREE.Color
  colorB: THREE.Color
  colorC: THREE.Color
}

function createWoodMaterial({
  scale = 1.0,
  ringFreq = 7.8,
  grainFreq = 500,
  colorA,
  colorB,
  colorC
}: WoodMaterialParams): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uScale: { value: scale },
      uRingFreq: { value: ringFreq },
      uGrainFreq: { value: grainFreq },
      uLightDir: { value: new THREE.Vector3(0.45, 0.9, 0.3).normalize() },
      uColorA: { value: colorA },
      uColorB: { value: colorB },
      uColorC: { value: colorC }
    },
    vertexShader: `
      varying vec3 vObjPos;
      varying vec3 vNormalW;

      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vObjPos = position;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      precision highp float;

      uniform float uScale;
      uniform float uRingFreq;
      uniform float uGrainFreq;
      uniform vec3 uLightDir;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform vec3 uColorC;

      varying vec3 vObjPos;
      varying vec3 vNormalW;

      #define sat(x) clamp(x, 0.0, 1.0)
      #define S(a, b, c) smoothstep(a, b, c)

      float sum2(vec2 v) { return dot(v, vec2(1.0)); }

      float h31(vec3 p3) {
        p3 = fract(p3 * .1031);
        p3 += dot(p3, p3.yzx + 333.3456);
        return fract(sum2(p3.xy) * p3.z);
      }

      float h21(vec2 p) { return h31(p.xyx); }

      float n31(vec3 p) {
        const vec3 s = vec3(7.0, 157.0, 113.0);
        vec3 ip = floor(p);
        p = fract(p);
        p = p * p * (3.0 - 2.0 * p);
        vec4 h = vec4(0.0, s.yz, sum2(s.yz)) + dot(ip, s);
        h = mix(fract(sin(h) * 43758.545), fract(sin(h + s.x) * 43758.545), p.x);
        h.xy = mix(h.xz, h.yw, p.y);
        return mix(h.x, h.y, p.z);
      }

      float fbm8(vec3 p, float roughness) {
        float sum = 0.0;
        float amp = 1.0;
        float tot = 0.0;
        roughness = sat(roughness);
        for (int i = 0; i < 8; i++) {
          sum += amp * n31(p);
          tot += amp;
          amp *= roughness;
          p *= 2.0;
        }
        return sum / max(tot, 0.0001);
      }

      vec3 randomPos(float seed) {
        vec4 s = vec4(seed, 0.0, 1.0, 2.0);
        return vec3(h21(s.xy), h21(s.xz), h21(s.xw)) * 1e2 + 1e2;
      }

      float fbmDistorted(vec3 p) {
        p += (vec3(n31(p + randomPos(0.0)), n31(p + randomPos(1.0)), n31(p + randomPos(2.0))) * 2.0 - 1.0) * 1.12;
        return fbm8(p, .5);
      }

      float musgraveFbm(vec3 p, float octaves, float dimension, float lacunarity) {
        float sum = 0.0;
        float amp = 1.0;
        float m = pow(lacunarity, -dimension);
        for (int i = 0; i < 16; i++) {
          if (float(i) >= octaves) break;
          float n = n31(p) * 2.0 - 1.0;
          sum += n * amp;
          amp *= m;
          p *= lacunarity;
        }
        return sum;
      }

      vec3 waveFbmX(vec3 p) {
        float n = p.x * 20.0;
        n += .4 * fbm8(p * 3.0, .3);
        return vec3(sin(n) * .5 + .5, p.yz);
      }

      float remap01(float f, float in1, float in2) { return sat((f - in1) / (in2 - in1)); }

      vec3 matWood(vec3 p) {
        float n1 = fbmDistorted(p * vec3(uRingFreq, 1.17, 1.17));
        n1 = mix(n1, 1.0, .2);
        float n2 = mix(musgraveFbm(vec3(n1 * 4.6), 8.0, 0.0, 2.5), n1, .85);
        float dirt = 1.0 - musgraveFbm(waveFbmX(p * vec3(.01, .15, .15)), 15.0, .26, 2.4) * .4;
        float grain = 1.0 - S(.2, 1.0, musgraveFbm(p * vec3(uGrainFreq, 6.0, 1.0), 2.0, 2.0, 2.5)) * .2;
        n2 *= dirt * grain;

        vec3 deep = mix(uColorA, uColorB, remap01(n2, .19, .56));
        return mix(deep, uColorC, remap01(n2, .56, 1.0));
      }

      void main() {
        vec3 p = vObjPos * uScale;
        vec3 wood = pow(matWood(p), vec3(.4545));
        float diffuse = 0.35 + max(dot(normalize(vNormalW), normalize(uLightDir)), 0.0) * 0.65;
        gl_FragColor = vec4(wood * diffuse, 1.0);
      }
    `
  })
}

export interface WoodMaterials {
  floorMaterial: THREE.ShaderMaterial
  tableMaterial: THREE.ShaderMaterial
}

export function createWoodMaterials(): WoodMaterials {
  const floorMaterial = createWoodMaterial({
    scale: 0.9,
    ringFreq: 20,
    grainFreq: 1,
    colorA: new THREE.Color(0x25170f),
    colorB: new THREE.Color(0x603822),
    colorC: new THREE.Color(0x6a6a36)
  })

  const tableMaterial = createWoodMaterial({
    scale: 0.12,
    ringFreq: 13.6,
    grainFreq: 720,
    colorA: new THREE.Color(0x1a0d05),
    colorB: new THREE.Color(0x4b2812),
    colorC: new THREE.Color(0x8c5128)
  })

  return { floorMaterial, tableMaterial }
}

interface TableWithLayout extends THREE.Group {
  userData: { updateCardLayout: (playerCount: number) => void }
}

export function createTable(tableMaterial: THREE.Material): TableWithLayout {
  const table = new THREE.Group() as TableWithLayout
  const tabletopHeight = 0.28
  const tabletopY = 1.95
  const tabletopRadius = 3.8
  const tableSurfaceY = tabletopY + tabletopHeight * 0.5

  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(tabletopRadius, tabletopRadius, tabletopHeight, 48),
    tableMaterial
  )
  top.position.y = tabletopY
  top.castShadow = true
  top.receiveShadow = true
  table.add(top)

  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.56, 1.8, 24), tableMaterial)
  leg.position.y = 0.95
  leg.castShadow = true
  table.add(leg)

  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 0.22, 28), tableMaterial)
  base.position.y = 0.2
  base.castShadow = true
  table.add(base)

  const footGeometry = new THREE.BoxGeometry(0.65, 0.16, 0.95)
  const footOffsets: [number, number, number][] = [
    [0, 0.08, 1.35],
    [0, 0.08, -1.35],
    [1.35, 0.08, 0],
    [-1.35, 0.08, 0]
  ]

  footOffsets.forEach(([x, y, z], index) => {
    const foot = new THREE.Mesh(footGeometry, tableMaterial)
    foot.position.set(x, y, z)
    if (index >= 2) {
      foot.rotation.y = Math.PI / 2
    }
    foot.castShadow = true
    foot.receiveShadow = true
    table.add(foot)
  })

  const cardMaterial = new THREE.MeshStandardMaterial({
    color: 0x1f355d,
    roughness: 0.75,
    metalness: 0.05
  })
  const cardGeometry = new THREE.BoxGeometry(0.62, 0.028, 0.92)
  const cardsGroup = new THREE.Group()
  table.add(cardsGroup)

  function updateCardLayout(playerCount: number): void {
    cardsGroup.clear()

    const count = Math.max(1, playerCount || 1)
    const cardRadius = tabletopRadius - 0.82
    const cardY = tableSurfaceY + 0.016

    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1)
      const angle = Math.PI + t * Math.PI
      const x = Math.cos(angle) * cardRadius
      const z = Math.sin(angle) * cardRadius

      const card = new THREE.Mesh(cardGeometry, cardMaterial)
      card.position.set(x, cardY, z)
      card.rotation.y = Math.atan2(-x, -z)
      card.castShadow = true
      card.receiveShadow = true
      cardsGroup.add(card)
    }
  }

  const deckBaseMaterial = new THREE.MeshStandardMaterial({
    color: 0xe3ddd3,
    roughness: 0.8,
    metalness: 0.0
  })
  const deck = new THREE.Group()
  const deckBase = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.18, 0.96), deckBaseMaterial)
  deckBase.position.y = tableSurfaceY + 0.09
  deckBase.castShadow = true
  deckBase.receiveShadow = true
  deck.add(deckBase)

  const deckTop = new THREE.Mesh(cardGeometry, cardMaterial)
  deckTop.position.y = tableSurfaceY + 0.196
  deckTop.rotation.y = Math.PI * 0.08
  deckTop.castShadow = true
  deckTop.receiveShadow = true
  deck.add(deckTop)
  table.add(deck)

  updateCardLayout(10)
  table.userData = { updateCardLayout }

  return table
}
