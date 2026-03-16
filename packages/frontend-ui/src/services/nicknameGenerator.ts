import nicknameWordsJson from '../../../shared/utils/nickname-words.json'

type NicknameWords = {
  adjectives: string[]
  occupations: string[]
}

const nicknameWords = nicknameWordsJson as NicknameWords
const REQUIRED_WORD_COUNT = 256

function assertWordListLengths(words: NicknameWords): void {
  if (words.adjectives.length !== REQUIRED_WORD_COUNT) {
    throw new Error(`Nickname adjectives list must contain exactly ${REQUIRED_WORD_COUNT} values.`)
  }
  if (words.occupations.length !== REQUIRED_WORD_COUNT) {
    throw new Error(`Nickname occupations list must contain exactly ${REQUIRED_WORD_COUNT} values.`)
  }
}

function getLast16BitsFromAddress(address: string): number {
  const normalizedHex = address
    .toLowerCase()
    .replace(/^0x/, '')
    .replace(/[^0-9a-f]/g, '')

  if (normalizedHex.length < 4) {
    throw new Error('Midnight address must contain at least 16 bits of hex payload.')
  }

  return Number.parseInt(normalizedHex.slice(-4), 16)
}

assertWordListLengths(nicknameWords)

export function deriveNicknameFromMidnightAddress(midnightAddress: string): string {
  const last16Bits = getLast16BitsFromAddress(midnightAddress)
  const adjectiveIdx = (last16Bits >> 8) & 0xff
  const occupationIdx = last16Bits & 0xff

  return `${nicknameWords.adjectives[adjectiveIdx]} ${nicknameWords.occupations[occupationIdx]}`
}
