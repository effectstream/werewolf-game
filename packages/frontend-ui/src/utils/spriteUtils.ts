import * as THREE from 'three'

export interface TextSpriteOptions {
  background?: string
  color?: string
  padding?: number
  scale?: number
}

export function makeTextSprite(
  message: string,
  options: TextSpriteOptions = {}
): THREE.Sprite {
  const { background = 'rgba(0,0,0,0.0)', color = '#ffffff', padding = 18, scale = 1 } = options

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')!
  const fontSize = 30
  context.font = `bold ${fontSize}px Arial`
  const metrics = context.measureText(message)
  const textWidth = metrics.width
  const width = Math.ceil(textWidth + padding * 2)
  const height = Math.ceil(fontSize + padding * 1.5)
  canvas.width = width
  canvas.height = height

  context.font = `bold ${fontSize}px Arial`
  context.fillStyle = background
  context.fillRect(0, 0, width, height)
  context.fillStyle = color
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(message, width / 2, height / 2 + 1)

  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  const spriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false
  })
  const sprite = new THREE.Sprite(spriteMaterial)
  sprite.scale.set((width / 180) * scale, (height / 180) * scale, 1)
  sprite.renderOrder = 999
  return sprite
}

export function makeBubbleSprite(message: string): THREE.Sprite {
  const { texture, scale } = createBubbleTexture(message)
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false
  })
  const sprite = new THREE.Sprite(material)
  sprite.scale.copy(scale)
  return sprite
}

export function createBubbleTexture(message: string): { texture: THREE.CanvasTexture; scale: THREE.Vector3 } {
  const fontSize = 30
  const lineHeight = 38
  const maxLineWidth = 380
  const padX = 26
  const padY = 16
  const tailHeight = 16
  const radius = 16
  const dpr = 2

  const measureCanvas = document.createElement('canvas')
  const measureCtx = measureCanvas.getContext('2d')!
  measureCtx.font = `bold ${fontSize}px Arial`
  const lines = wrapText(measureCtx, message, maxLineWidth)
  const contentWidth = Math.max(...lines.map((line) => measureCtx.measureText(line).width), 80)

  const logicalWidth = Math.ceil(contentWidth + padX * 2)
  const logicalHeight = Math.ceil(lines.length * lineHeight + padY * 2 + tailHeight)

  const canvas = document.createElement('canvas')
  canvas.width = logicalWidth * dpr
  canvas.height = logicalHeight * dpr

  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)

  ctx.fillStyle = 'rgba(255, 255, 255, 0.97)'
  roundRect(ctx, 0, 0, logicalWidth, logicalHeight - tailHeight, radius)
  ctx.fill()

  const tailY = logicalHeight - tailHeight
  const tailX = logicalWidth / 2
  ctx.beginPath()
  ctx.moveTo(tailX - 12, tailY)
  ctx.lineTo(tailX + 12, tailY)
  ctx.lineTo(tailX, logicalHeight)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#10131f'
  ctx.font = `bold ${fontSize}px Arial`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  lines.forEach((line, index) => {
    ctx.fillText(line, logicalWidth / 2, padY + index * lineHeight)
  })

  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  const scale = new THREE.Vector3(logicalWidth / 88, logicalHeight / 88, 1)

  return { texture, scale }
}

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/)
  const lines: string[] = []
  let line = words[0] || ''

  for (let i = 1; i < words.length; i += 1) {
    const testLine = `${line} ${words[i]}`
    if (ctx.measureText(testLine).width > maxWidth) {
      lines.push(line)
      line = words[i]
    } else {
      line = testLine
    }
  }

  if (line) {
    lines.push(line)
  }

  return lines
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}
