import wordList from './werewolf-words.json'

const wordToIndex: Map<string, number> = new Map()
for (let i = 0; i < wordList.length; i++) {
  wordToIndex.set(wordList[i], i)
}

/**
 * Decode a 4-word phrase back to a uint32 game ID.
 * Words are separated by a single space.
 * Throws if the phrase is not exactly 4 known words.
 */
export function decodeGamePhrase(phrase: string): number {
  const parts = phrase.trim().split(' ')
  if (parts.length !== 4) {
    throw new Error('Game phrase must be exactly 4 words separated by spaces.')
  }
  const bytes = parts.map((word) => {
    const index = wordToIndex.get(word)
    if (index === undefined) {
      throw new Error(`Unknown word in phrase: "${word}"`)
    }
    return index
  })
  return (((bytes[0] << 24) >>> 0) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
}

/**
 * Returns true if the string looks like a 4-word phrase (no digits).
 */
export function isGamePhrase(value: string): boolean {
  return /^\s*[a-zA-Z]+(?:\s+[a-zA-Z]+){3}\s*$/.test(value)
}
