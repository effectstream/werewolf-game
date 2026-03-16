import defaultWordList from "./werewolf-words.json" with { type: "json" };

export class WerewolfIdCodec {
  private words: Array<string>;
  private wordToIndex: Map<string, number>;
  private separator: string = " ";
  constructor(wordList: Array<string> = defaultWordList) {
    if (!Array.isArray(wordList) || wordList.length !== 256) {
      throw new Error("Word list must be an array of exactly 256 words.");
    }

    this.words = wordList.slice();
    this.wordToIndex = new Map();

    for (let i = 0; i < this.words.length; i++) {
      const word = this.words[i];

      if (typeof word !== "string") {
        throw new Error("All words must be strings.");
      }

      if (this.wordToIndex.has(word)) {
        throw new Error(`Duplicate word detected: ${word}`);
      }

      this.wordToIndex.set(word, i);
    }
  }

  // Encode uint32 (number or bigint) -> 4-word phrase
  encode(uint32: number | bigint): string {
    const MAX_UINT32 = 0xFFFFFFFFn;

    if (typeof uint32 === "bigint") {
      if (uint32 < 0n || uint32 > MAX_UINT32) {
        throw new Error("Input must be a valid uint32.");
      }

      const b1 = Number((uint32 >> 24n) & 0xFFn);
      const b2 = Number((uint32 >> 16n) & 0xFFn);
      const b3 = Number((uint32 >> 8n) & 0xFFn);
      const b4 = Number(uint32 & 0xFFn);

      return [
        this.words[b1],
        this.words[b2],
        this.words[b3],
        this.words[b4],
      ].join(this.separator);
    }

    if (!Number.isInteger(uint32) || uint32 < 0 || uint32 > 0xFFFFFFFF) {
      throw new Error("Input must be a valid uint32.");
    }

    const value = uint32 >>> 0;

    const b1 = (value >>> 24) & 0xFF;
    const b2 = (value >>> 16) & 0xFF;
    const b3 = (value >>> 8) & 0xFF;
    const b4 = value & 0xFF;

    return [
      this.words[b1],
      this.words[b2],
      this.words[b3],
      this.words[b4],
    ].join(this.separator);
  }

  // Decode 4-word phrase -> uint32 (number)
  decode(phrase: string): number | bigint {
    if (typeof phrase !== "string") {
      throw new Error("Phrase must be a string.");
    }

    const parts = phrase.split(this.separator);

    if (parts.length !== 4) {
      throw new Error(
        `Phrase must contain exactly 4 words separated by "${this.separator}".`,
      );
    }

    const bytes = parts.map((word) => {
      const index = this.wordToIndex.get(word);
      if (index === undefined) {
        throw new Error(`Invalid word in phrase: ${word}`);
      }
      return index;
    });

    return (
      ((bytes[0] << 24) >>> 0) |
      (bytes[1] << 16) |
      (bytes[2] << 8) |
      bytes[3]
    ) >>> 0;
  }
}

export const werewolfIdCodec = new WerewolfIdCodec(defaultWordList);
