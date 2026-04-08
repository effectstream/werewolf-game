import type { HairStyle, PlayerConfig } from './models/PlayerConfigInterface'

export interface AvatarSelection {
  skinTone: number
  shirtColor: number
  hairColor: number
  hairStyle: number
}

export const SKIN_TONES = [
  0xf5d6b3, // light peach
  0xe8b894, // warm beige
  0xd39a72, // tan
  0xb07a4f, // bronze
  0x8a5a36, // brown
  0x6f452f, // dark brown
  0x4a2c1d, // deep brown
  0xf0d74d, // golden (fantasy)
  0xa8d8a8, // pale green (fantasy)
  0xb4a4d8, // pale lavender (fantasy)
  0x4f8a5a, // deep green (fantasy)
  0x9aa0a8, // stone grey (fantasy)
  0xb84a3a, // crimson red (fantasy)
  0x8ec5e8, // light blue (fantasy)
] as const

export const SHIRT_COLORS = [
  0xc43f4f, // red
  0xe67e22, // orange
  0xf1c40f, // yellow
  0x38a169, // green
  0x16a085, // teal
  0x2f60d1, // blue
  0x6c5ce7, // indigo
  0x8e44ad, // purple
  0xd63384, // pink
  0x2c2c2c, // black
  0xf5f5f5, // white
  0x795548, // brown
  0x607d8b, // slate
  0x00bcd4, // cyan
] as const

export const HAIR_COLORS = [
  0x171717, // black
  0x4a2e1f, // dark brown
  0x6b4423, // brown
  0xa67b4a, // light brown
  0xd4af37, // blonde
  0xf2d98d, // platinum blonde
  0xc0392b, // red
  0xe8623d, // ginger
  0x95a5a6, // grey
  0xf5f5f5, // white
  0x4a90e2, // blue (fantasy)
  0x9b59b6, // purple (fantasy)
  0xff69b4, // pink (fantasy)
  0x27ae60, // green (fantasy)
] as const

export const HAIR_STYLES = [
  'square',
  'round',
  'pointy',
  'ponytail',
  'baseballCap',
  'topHat',
  'mohawk',
  'jrpg',
] as const satisfies readonly HairStyle[]

export const HAIR_STYLE_LABELS: Record<HairStyle, string> = {
  square: 'Square',
  round: 'Round',
  pointy: 'Pointy',
  ponytail: 'Ponytail',
  baseballCap: 'Baseball Cap',
  topHat: 'Top Hat',
  mohawk: 'Mohawk',
  jrpg: 'JRPG Spikes',
}

export const DEFAULT_AVATAR_SELECTION: AvatarSelection = {
  skinTone: 0,
  shirtColor: 0,
  hairColor: 0,
  hairStyle: 0,
}

// 16-bit packed appearance code: 4 bits per trait.
// bits  0..3  -> skinTone   (mask 0xF)
// bits  4..7  -> shirtColor (mask 0xF)
// bits  8..11 -> hairColor  (mask 0xF)
// bits 12..15 -> hairStyle  (mask 0xF)
export function isValidAppearanceCode(value: number): boolean {
  if (!Number.isInteger(value) || value < 0 || value > 0xFFFF) return false
  const skinTone = value & 0xF
  const shirtColor = (value >> 4) & 0xF
  const hairColor = (value >> 8) & 0xF
  const hairStyle = (value >> 12) & 0xF
  return (
    skinTone < SKIN_TONES.length &&
    shirtColor < SHIRT_COLORS.length &&
    hairColor < HAIR_COLORS.length &&
    hairStyle < HAIR_STYLES.length
  )
}

export function encodeAppearance(selection: AvatarSelection): number {
  if (
    selection.skinTone < 0 || selection.skinTone >= SKIN_TONES.length ||
    selection.shirtColor < 0 || selection.shirtColor >= SHIRT_COLORS.length ||
    selection.hairColor < 0 || selection.hairColor >= HAIR_COLORS.length ||
    selection.hairStyle < 0 || selection.hairStyle >= HAIR_STYLES.length
  ) {
    throw new Error('Invalid avatar selection.')
  }

  return (
    selection.skinTone |
    (selection.shirtColor << 4) |
    (selection.hairColor << 8) |
    (selection.hairStyle << 12)
  )
}

export function decodeAppearance(appearanceCode: number): AvatarSelection {
  if (!isValidAppearanceCode(appearanceCode)) {
    throw new Error(`Invalid appearance code: ${appearanceCode}`)
  }

  return {
    skinTone: appearanceCode & 0xF,
    shirtColor: (appearanceCode >> 4) & 0xF,
    hairColor: (appearanceCode >> 8) & 0xF,
    hairStyle: (appearanceCode >> 12) & 0xF,
  }
}

export function appearanceToPlayerConfig(
  appearanceCode: number,
  name: string = 'Player',
): PlayerConfig {
  const selection = decodeAppearance(appearanceCode)

  return {
    name,
    cloth: SHIRT_COLORS[selection.shirtColor],
    hair: HAIR_COLORS[selection.hairColor],
    skin: SKIN_TONES[selection.skinTone],
    hairStyle: HAIR_STYLES[selection.hairStyle],
  }
}

export function randomAvatarSelection(): AvatarSelection {
  return {
    skinTone: Math.floor(Math.random() * SKIN_TONES.length),
    shirtColor: Math.floor(Math.random() * SHIRT_COLORS.length),
    hairColor: Math.floor(Math.random() * HAIR_COLORS.length),
    hairStyle: Math.floor(Math.random() * HAIR_STYLES.length),
  }
}

const AVATAR_STORAGE_KEY = 'werewolf-avatar-selection'

export function hasAvatarSelection(): boolean {
  try {
    return localStorage.getItem(AVATAR_STORAGE_KEY) !== null
  } catch {
    return false
  }
}

export function saveAvatarSelection(selection: AvatarSelection): void {
  try {
    localStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(selection))
  } catch (err) {
    console.warn('[avatarAppearance] Failed to save avatar selection:', err)
  }
}

function clampIndex(value: unknown, length: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback
  if (value < 0 || value >= length) return fallback
  return value
}

export function loadAvatarSelection(): AvatarSelection {
  try {
    const stored = localStorage.getItem(AVATAR_STORAGE_KEY)
    if (!stored) return { ...DEFAULT_AVATAR_SELECTION }

    const parsed = JSON.parse(stored) as Partial<AvatarSelection>

    return {
      skinTone: clampIndex(parsed.skinTone, SKIN_TONES.length, DEFAULT_AVATAR_SELECTION.skinTone),
      shirtColor: clampIndex(parsed.shirtColor, SHIRT_COLORS.length, DEFAULT_AVATAR_SELECTION.shirtColor),
      hairColor: clampIndex(parsed.hairColor, HAIR_COLORS.length, DEFAULT_AVATAR_SELECTION.hairColor),
      hairStyle: clampIndex(parsed.hairStyle, HAIR_STYLES.length, DEFAULT_AVATAR_SELECTION.hairStyle),
    }
  } catch (err) {
    console.warn('[avatarAppearance] Failed to load avatar selection, using default:', err)
    return { ...DEFAULT_AVATAR_SELECTION }
  }
}
