import type { PlayerConfig } from './models/PlayerConfigInterface'

export interface AvatarSelection {
  skinTone: number
  shirtColor: number
  hairColor: number
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

export const DEFAULT_AVATAR_SELECTION: AvatarSelection = {
  skinTone: 0,
  shirtColor: 0,
  hairColor: 0,
}

const DEFAULT_HAIR_SHAPE = {
  hairWidth: 0.6,
  hairHeight: 0.24,
  hairDepth: 0.56,
  hasBun: false,
  bunSize: 0,
} as const

export function isValidAppearanceCode(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < 64
}

export function encodeAppearance(selection: AvatarSelection): number {
  if (
    selection.skinTone < 0 || selection.skinTone >= SKIN_TONES.length ||
    selection.shirtColor < 0 || selection.shirtColor >= SHIRT_COLORS.length ||
    selection.hairColor < 0 || selection.hairColor >= HAIR_COLORS.length
  ) {
    throw new Error('Invalid avatar selection.')
  }

  return selection.skinTone | (selection.shirtColor << 2) | (selection.hairColor << 4)
}

export function decodeAppearance(appearanceCode: number): AvatarSelection {
  if (!isValidAppearanceCode(appearanceCode)) {
    throw new Error(`Invalid appearance code: ${appearanceCode}`)
  }

  return {
    skinTone: appearanceCode & 0b11,
    shirtColor: (appearanceCode >> 2) & 0b11,
    hairColor: (appearanceCode >> 4) & 0b11,
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
    ...DEFAULT_HAIR_SHAPE,
  }
}
