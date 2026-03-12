import type { HairStyle, PlayerConfig } from './models/PlayerConfigInterface'

export interface AvatarSelection {
  skinTone: number
  shirtColor: number
  hairColor: number
  hairStyle: number
}

export const SKIN_TONES = [
  0xf5d6b3,
  0xd39a72,
  0x6f452f,
  0xf0d74d,
] as const

export const SHIRT_COLORS = [
  0xc43f4f,
  0x2f60d1,
  0x38a169,
  0x8e44ad,
] as const

export const HAIR_COLORS = [
  0x171717,
  0x6b4423,
  0xd4af37,
  0xc0392b,
] as const

export const HAIR_STYLES = [
  'square',
  'round',
  'pointy',
  'ponytail',
] as const satisfies readonly HairStyle[]

export const HAIR_STYLE_LABELS: Record<HairStyle, string> = {
  square: 'Square',
  round: 'Round',
  pointy: 'Pointy',
  ponytail: 'Ponytail',
}

export const DEFAULT_AVATAR_SELECTION: AvatarSelection = {
  skinTone: 0,
  shirtColor: 0,
  hairColor: 0,
  hairStyle: 0,
}

export function isValidAppearanceCode(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < 256
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
    (selection.shirtColor << 2) |
    (selection.hairColor << 4) |
    (selection.hairStyle << 6)
  )
}

export function decodeAppearance(appearanceCode: number): AvatarSelection {
  if (!isValidAppearanceCode(appearanceCode)) {
    throw new Error(`Invalid appearance code: ${appearanceCode}`)
  }

  return {
    skinTone: appearanceCode & 0b11,
    shirtColor: (appearanceCode >> 2) & 0b11,
    hairColor: (appearanceCode >> 4) & 0b11,
    hairStyle: (appearanceCode >> 6) & 0b11,
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
