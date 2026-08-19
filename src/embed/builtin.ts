import type { Embedder } from './embedder.js';
import { normalize } from './embedder.js';

const DIMENSIONS = 256;

export class BuiltinEmbedder implements Embedder {
  readonly id = 'builtin-hashing';
  readonly dimensions = DIMENSIONS;
  readonly minRelevance = 0.18;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.vectorize(text));
  }

  private vectorize(text: string): number[] {
    const vector = new Array<number>(DIMENSIONS).fill(0);
    const words = text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 1);

    for (const word of words) {
      add(vector, `w:${word}`, 1);
      for (const gram of trigrams(word)) add(vector, `g:${gram}`, 0.35);
    }

    for (let i = 1; i < words.length; i += 1) {
      add(vector, `b:${words[i - 1]}_${words[i]}`, 0.5);
    }

    return normalize(vector);
  }
}

function add(vector: number[], token: string, weight: number): void {
  const hash = fnv1a(token);
  const index = hash % DIMENSIONS;
  const sign = (hash >>> 31) & 1 ? -1 : 1;
  vector[index] = (vector[index] ?? 0) + weight * sign;
}

function trigrams(word: string): string[] {
  const padded = `^${word}$`;
  const grams: string[] = [];
  for (let i = 0; i + 3 <= padded.length; i += 1) {
    grams.push(padded.slice(i, i + 3));
  }
  return grams;
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
