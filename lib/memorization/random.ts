import { createHash, randomInt } from "node:crypto";

export interface RandomSource {
  int(minInclusive: number, maxExclusive: number): number;
  shuffle<T>(items: readonly T[]): T[];
}

export class CryptoRandomSource implements RandomSource {
  int(minInclusive: number, maxExclusive: number): number {
    return randomInt(minInclusive, maxExclusive);
  }

  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swapIndex = this.int(0, index + 1);
      [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    }
    return copy;
  }
}

export class SeededRandomSource implements RandomSource {
  private state: number;

  constructor(seed: string) {
    const digest = createHash("sha256").update(seed).digest();
    this.state = digest.readUInt32LE(0) || 0x6d2b79f5;
  }

  int(minInclusive: number, maxExclusive: number): number {
    if (maxExclusive <= minInclusive) {
      throw new Error("Invalid random range");
    }
    const value = this.next();
    return minInclusive + Math.floor(value * (maxExclusive - minInclusive));
  }

  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swapIndex = this.int(0, index + 1);
      [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    }
    return copy;
  }

  private next() {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
