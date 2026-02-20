import * as THREE from 'three'

const flameMaterials: THREE.ShaderMaterial[] = []

export function updateDecorations(time: number, environmentMix: number = 0) {
  flameMaterials.forEach(mat => {
    if (mat.uniforms && mat.uniforms.uTime) {
      mat.uniforms.uTime.value = time
    }
    if (mat.uniforms && mat.uniforms.uOpacity) {
      mat.uniforms.uOpacity.value = 1.0 - environmentMix
    }
  })
}

export function createCandle(): THREE.Group {
  const group = new THREE.Group()

  // Wax body
  const waxGeometry = new THREE.CylinderGeometry(0.08, 0.08, 0.4, 16)
  const waxMaterial = new THREE.MeshStandardMaterial({
    color: 0xddddcc,
    roughness: 0.3,
    metalness: 0.0
  })
  const wax = new THREE.Mesh(waxGeometry, waxMaterial)
  wax.position.y = 0.2
  wax.castShadow = true
  wax.receiveShadow = true
  group.add(wax)

  // Flame
  const flameGeometry = new THREE.ConeGeometry(0.04, 0.12, 8)
  const flameMaterial = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime: { value: Math.random() * 100 }, // Randomize start time slightly
      uColor: { value: new THREE.Color(0xffaa00) },
      uOpacity: { value: 1.0 }
    },
    vertexShader: `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 pos = position;
        
        // Flame height is 0.12, centered at 0. Bottom is -0.06, top is +0.06
        float h = max(0.0, (pos.y + 0.06) / 0.12);
        
        // Add slight waving motion to the top
        pos.x += sin(uTime * 8.0 + pos.y * 20.0) * h * 0.015;
        pos.z += cos(uTime * 9.0 + pos.y * 20.0) * h * 0.015;
        
        // Slight pulsating scale
        float scale = 1.0 + sin(uTime * 14.0) * 0.08 * h;
        pos.y *= scale;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        gl_FragColor = vec4(uColor, uOpacity);
      }
    `
  })
  flameMaterials.push(flameMaterial)
  
  const flame = new THREE.Mesh(flameGeometry, flameMaterial)
  flame.position.y = 0.46
  group.add(flame)

  // Light
  // const light = new THREE.PointLight(0xff8800, 0.5, 4)
  // light.position.y = 0.5
  // light.castShadow = true
  // group.add(light)

  return group
}

export function createBookshelf(): THREE.Group {
  const group = new THREE.Group()
  const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x2a160c, roughness: 0.9 })

  // Frame
  const sideGeo = new THREE.BoxGeometry(0.2, 5, 1)
  const leftSide = new THREE.Mesh(sideGeo, woodMaterial)
  leftSide.position.set(-1.4, 2.5, 0)
  leftSide.castShadow = true
  group.add(leftSide)

  const rightSide = new THREE.Mesh(sideGeo, woodMaterial)
  rightSide.position.set(1.4, 2.5, 0)
  rightSide.castShadow = true
  group.add(rightSide)

  const topGeo = new THREE.BoxGeometry(3, 0.2, 1)
  const top = new THREE.Mesh(topGeo, woodMaterial)
  top.position.set(0, 5.1, 0)
  top.castShadow = true
  group.add(top)

  // Shelves
  const shelfGeo = new THREE.BoxGeometry(2.8, 0.1, 0.95)
  for (let i = 0; i < 5; i++) {
    const shelf = new THREE.Mesh(shelfGeo, woodMaterial)
    shelf.position.set(0, 0.8 + i * 1, 0)
    shelf.castShadow = true
    group.add(shelf)
  }

  // Books
  const bookColors = [0x4a0e0e, 0x0d2b14, 0x141836, 0x3d2314, 0x1a1a1a]
  const shelfHeights = [0.85, 1.85, 2.85, 3.85]
  
  shelfHeights.forEach(y => {
    let currentX = -1.2
    while (currentX < 1.2) {
      if (Math.random() > 0.3) {
        const width = 0.1 + Math.random() * 0.15
        const height = 0.5 + Math.random() * 0.4
        const depth = 0.6 + Math.random() * 0.2
        
        const bookGeo = new THREE.BoxGeometry(width, height, depth)
        const bookMat = new THREE.MeshStandardMaterial({ 
          color: bookColors[Math.floor(Math.random() * bookColors.length)],
          roughness: 0.7
        })
        const book = new THREE.Mesh(bookGeo, bookMat)
        
        // Random tilt for some books
        if (Math.random() > 0.8 && currentX < 1.0) {
          book.rotation.z = (Math.random() - 0.5) * 0.5
        }
        
        book.position.set(currentX + width / 2, y + height / 2, (Math.random() - 0.5) * 0.1)
        book.castShadow = true
        group.add(book)
        
        currentX += width + 0.02
      } else {
        currentX += 0.2 // Gap
      }
    }
  })

  return group
}

export function createPainting(width: number, height: number, imageUrl: string, frameColor = 0x3d2314, canvasColor = 0x223344): THREE.Group {
  const group = new THREE.Group()

  // Frame
  const frameThickness = 0.1
  const frameDepth = 0.05
  const frameGeo = new THREE.BoxGeometry(width + frameThickness * 2, height + frameThickness * 2, frameDepth)
  const frameMat = new THREE.MeshStandardMaterial({ 
    color: frameColor, 
    roughness: 0.8,
    metalness: 0.1 
  })
  const frame = new THREE.Mesh(frameGeo, frameMat)
  frame.castShadow = true
  group.add(frame)

  // Canvas
  // const canvasGeo = new THREE.BoxGeometry(width, height, frameDepth + 0.01)
  // const canvasMat = new THREE.MeshStandardMaterial({ 
  //   color: canvasColor,
  //   roughness: 0.9,
  //   metalness: 0.0
  // })
  // const canvas = new THREE.Mesh(canvasGeo, canvasMat)
  // canvas.position.z = 0.01 // push slightly out from the frame center
  // group.add(canvas)

  // Image Plane
  const textureLoader = new THREE.TextureLoader()
  const texture = textureLoader.load(imageUrl)
  // Ensure correct color space for textures
  if ('colorSpace' in texture) {
    texture.colorSpace = THREE.SRGBColorSpace
  } else {
    // Fallback for older three.js versions
    ;(texture as any).encoding = 3001 // THREE.sRGBEncoding
  }

  const imageGeo = new THREE.PlaneGeometry(width * 0.95, height * 0.95) // Slightly smaller to act as a matting
  const imageMat = new THREE.MeshStandardMaterial({ 
    map: texture,
    roughness: 0.8,
    metalness: 0.1
  })
  const imagePlane = new THREE.Mesh(imageGeo, imageMat)
  imagePlane.position.z = frameDepth / 2 + 0.016 // slight offset to prevent z-fighting with canvas
  group.add(imagePlane)

  return group
}

export function createFloorDecorations(): THREE.Group {
  const group = new THREE.Group()
  // Add some floor candles scattered around
  for (let i = 0; i < 12; i++) {
    const candle = createCandle()
    const angle = Math.random() * Math.PI * 2
    const radius = 4.5 + Math.random() * 6.5
    candle.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
    const scale = 0.7 + Math.random() * 0.8
    candle.scale.set(scale, scale, scale)
    group.add(candle)
  }
  return group
}

export function createTableDecorations(): THREE.Group {
  const group = new THREE.Group()
  
  // A few candles for the table
  const positions = [
    { x: 1.5, z: 1.0 },
    { x: -1.2, z: 1.8 },
    { x: 0.5, z: -1.5 },
    { x: -0.8, z: -1.2 }
  ]
  
  positions.forEach(pos => {
    const candle = createCandle()
    candle.position.set(pos.x, 2.09, pos.z) // Table height
    const scale = 0.5 + Math.random() * 0.3
    candle.scale.set(scale, scale, scale)
    group.add(candle)
  })

  return group
}
