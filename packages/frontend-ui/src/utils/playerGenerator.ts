// Seeded random number generator for deterministic results
class SeededRandom {
  private seed: number

  constructor(seed: number) {
    this.seed = seed
  }

  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280
    return this.seed / 233280
  }

  nextInt(max: number): number {
    return Math.floor(this.next() * max)
  }

  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min)
  }
}

// Extensive list of names
const NAMES = [
  'Alex', 'Sam', 'Nora', 'Milo', 'Iris', 'Leo', 'Zoe', 'Omar', 'June', 'Noah',
  'Luna', 'Ava', 'Ethan', 'Maya', 'Finn', 'Ruby', 'Kai', 'Lily', 'Max', 'Emma',
  'Jake', 'Sage', 'River', 'Sky', 'Blake', 'Riley', 'Quinn', 'Avery', 'Casey', 'Dakota',
  'Phoenix', 'Rowan', 'Morgan', 'Taylor', 'Jordan', 'Cameron', 'Drew', 'Hayden', 'Reese', 'Sloane',
  'Adrian', 'Blair', 'Dana', 'Emery', 'Finley', 'Harper', 'Indigo', 'Jules', 'Kendall', 'Logan',
  'Marley', 'Nico', 'Ocean', 'Parker', 'Quinn', 'Reese', 'Sage', 'Tatum', 'Vale', 'Winter'
]

// Extensive hair colors (realistic and fantasy)
const HAIR_COLORS = [
  // Natural colors
  0x241a16, 0x31231d, 0x1f1312, 0x4b2e1e, 0x101419, 0x7b5a3b, 0x262626, 0x171717, 0x3b2a25, 0x5e3c28,
  0x2a1f1a, 0x8b4513, 0x654321, 0x3d2817, 0x2f1b14, 0x1a0f0a, 0x4a3728, 0x6b4423, 0x8b6f47, 0xa0826d,
  // Blonde shades
  0xd4af37, 0xf4d03f, 0xffd700, 0xffeaa7, 0xfef9e7, 0xfef5e7, 0xfef3c7, 0xfef1a7, 0xfee987, 0xfee167,
  // Red shades
  0xa0522d, 0x8b4513, 0xcd5c5c, 0xdc143c, 0xff4500, 0xff6347, 0xff7f50, 0xff8c69, 0xffa07a, 0xffb347,
  // Gray/White
  0x808080, 0xa9a9a9, 0xc0c0c0, 0xd3d3d3, 0xe8e8e8, 0xf5f5f5, 0xffffff, 0xf0f0f0, 0xe0e0e0, 0xd0d0d0,
  // Fantasy colors
  0xff00ff, 0x9400d3, 0x4b0082, 0x0000ff, 0x00ffff, 0x00ff00, 0xffff00, 0xff1493, 0xff69b4, 0xff1493,
  0x8a2be2, 0x9370db, 0xba55d3, 0xda70d6, 0xee82ee, 0xff00ff, 0xff1493, 0xff69b4, 0xffb6c1, 0xffc0cb,
  // Unusual colors
  0x00ff00, 0x32cd32, 0x00ced1, 0x00bfff, 0x1e90ff, 0x4169e1, 0x0000cd, 0x00008b, 0x191970, 0x000080,
  0xff4500, 0xff6347, 0xff7f50, 0xff8c00, 0xffa500, 0xffb347, 0xffc125, 0xffd700, 0xffe135, 0xffef00
]

// Extensive skin colors (realistic and fantasy)
const SKIN_COLORS = [
  // Realistic skin tones
  0xf1c9a4, 0xd9a47f, 0xf7d8b5, 0xe5b98e, 0xc48b67, 0xf3ccaa, 0x9b6544, 0x6f452f, 0xd09f79, 0xb37e56,
  0xe8c4a0, 0xf5deb3, 0xffdbac, 0xffcc99, 0xffcc99, 0xffdbac, 0xf5deb3, 0xe8c4a0, 0xd2b48c, 0xc19a6b,
  0xdeb887, 0xd2b48c, 0xc19a6b, 0xb8860b, 0xdaa520, 0xcd853f, 0xd2691e, 0xbc8f8f, 0xa0522d, 0x8b4513,
  // Lighter tones
  0xfff8dc, 0xfffef0, 0xfffef5, 0xfffef9, 0xfffefd, 0xfffef7, 0xfffef2, 0xfffeef, 0xfffeec, 0xfffee9,
  // Medium tones
  0xd2b48c, 0xc19a6b, 0xb8860b, 0xdaa520, 0xcd853f, 0xd2691e, 0xbc8f8f, 0xa0522d, 0x8b4513, 0x654321,
  // Darker tones
  0x654321, 0x5d4037, 0x4e342e, 0x3e2723, 0x2e1b14, 0x1a0f0a, 0x0d0503, 0x080402, 0x040201, 0x020100,
  // Fantasy colors
  0xff69b4, 0xff1493, 0xff00ff, 0x9400d3, 0x4b0082, 0x0000ff, 0x00ffff, 0x00ff00, 0xffff00, 0xff4500,
  0xff6347, 0xff7f50, 0xff8c00, 0xffa500, 0xffb347, 0xffc125, 0xffd700, 0xffe135, 0xffef00, 0xfff700,
  // Unusual colors
  0x00ff00, 0x32cd32, 0x00ced1, 0x00bfff, 0x1e90ff, 0x4169e1, 0x0000cd, 0x00008b, 0x191970, 0x000080,
  0xffebcd, 0xffe4b5, 0xffdead, 0xffdab9, 0xffcccb, 0xffb6c1, 0xffc0cb, 0xffddf4, 0xffe4e1, 0xfff0f5
]

// Extensive cloth/clothing colors
const CLOTH_COLORS = [
  0xc43f4f, 0x2f60d1, 0x38a169, 0xb5742f, 0x8e44ad, 0x2f9ca1, 0xad3c7d, 0x3f7a42, 0x5064c7, 0x8d5f27,
  0xd97757, 0xff6b6b, 0x4ecdc4, 0x45b7d1, 0x96ceb4, 0xffeaa7, 0xdda15e, 0xbc6c25, 0x606c38, 0x283618,
  0xff5733, 0xc70039, 0x900c3f, 0x581845, 0xffc300, 0xff5733, 0xc70039, 0x900c3f, 0x581845, 0xffc300,
  0x00a8cc, 0x0c7b93, 0x27496d, 0x142850, 0x00909e, 0x00d2ff, 0x3d84a8, 0x46b3e6, 0x5dade2, 0x85c1e2,
  0x6c5ce7, 0xa29bfe, 0xfd79a8, 0xfdcb6e, 0xe17055, 0x00b894, 0x00cec9, 0x55efc4, 0x81ecec, 0x74b9ff,
  0x0984e3, 0x74b9ff, 0x81ecec, 0x55efc4, 0x00cec9, 0x00b894, 0xe17055, 0xfdcb6e, 0xfd79a8, 0xa29bfe,
  0x6c5ce7, 0x5f3dc4, 0x364fc7, 0x1864ab, 0x0c5460, 0x087f5b, 0x2b8a3e, 0x51cf66, 0x69db7c, 0x8ce99a,
  0xff6b9d, 0xc92a2a, 0xe03131, 0xff6b6b, 0xff8787, 0xffa8a8, 0xffc9c9, 0xffe0e0, 0xfff0f0, 0xfff5f5,
  0x495057, 0x343a40, 0x212529, 0x1a1d20, 0x0d1117, 0x161b22, 0x1c2128, 0x22272e, 0x2d333b, 0x373e47
]

export interface BasePlayerConfig {
  name: string
  cloth: number
  hair: number
  skin: number
}

/**
 * Generates player configurations deterministically based on a seed and count
 */
export function generatePlayerConfigs(playerCount: number, seed: number = 42): BasePlayerConfig[] {
  const rng = new SeededRandom(seed)
  const configs: BasePlayerConfig[] = []
  const usedNames = new Set<string>()

  for (let i = 0; i < playerCount; i++) {
    // Select a unique name
    let name: string
    let attempts = 0
    do {
      const nameIndex = rng.nextInt(NAMES.length)
      name = NAMES[nameIndex]
      attempts++
      // Fallback if we run out of unique names
      if (attempts > 100) {
        name = `${NAMES[rng.nextInt(NAMES.length)]} ${i + 1}`
        break
      }
    } while (usedNames.has(name))
    usedNames.add(name)

    // Select colors
    const clothColor = CLOTH_COLORS[rng.nextInt(CLOTH_COLORS.length)]
    const hairColor = HAIR_COLORS[rng.nextInt(HAIR_COLORS.length)]
    const skinColor = SKIN_COLORS[rng.nextInt(SKIN_COLORS.length)]

    configs.push({
      name,
      cloth: clothColor,
      hair: hairColor,
      skin: skinColor
    })
  }

  return configs
}

/**
 * Generates hair parameters deterministically for a player
 */
export function generateHairParameters(seed: number): {
  hairWidth: number
  hairHeight: number
  hairDepth: number
  hasBun: boolean
  bunSize: number
} {
  const rng = new SeededRandom(seed)
  const hairWidth = 0.52 + rng.nextFloat(0, 0.18)
  const hairHeight = 0.15 + rng.nextFloat(0, 0.3)
  const hairDepth = 0.52 + rng.nextFloat(0, 0.1)
  const hasBun = rng.next() > 0.7
  const bunSize = hasBun ? 0.15 + rng.nextFloat(0, 0.1) : 0
  
  return {
    hairWidth,
    hairHeight,
    hairDepth,
    hasBun,
    bunSize
  }
}
