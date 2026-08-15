import type { Embedder } from './embedder.js';
import { normalize } from './embedder.js';

const DIMENSIONS = 256;

/**
 * Zero-dependency embedder using the hashing trick over word and character
 * n-grams. Installs nothing, downloads nothing, runs in microseconds.
 *
 * Honest about what this is: it captures lexical and morphological similarity,
 * not meaning. "reconnect" matches "reconnecting" and survives typos, which
 * plain FTS5 token matching does not. It will NOT match "car" to "automobile"
 * the way a real sentence-transformer does.
 *
 * Its job is to be the floor, so that zero-config installs get fuzzy recall
 * instead of nothing when the ONNX model is unavailable.
 */
export class BuiltinEmbedder implements Embedder {
  readonly id = 'builtin-hashing';
  readonly dimensions = DIMENSIONS;
  // Measured: unrelated queries top out at 0.135, related start at 0.235.
  readonly minRelevance = 0.18;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.vectorize(text));
  }

  private vectorize(text: string): number[] {
    const vector = new Array<number>(DIMENSIONS).fill(0);
    const words = text
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((word) => word.length > 1);

    for (const word of words) {
      // Whole word carries the most signal.
      add(vector, `w:${word}`, 1);
      // Character trigrams give partial credit for shared stems and typos.
      for (const gram of trigrams(word)) add(vector, `g:${gram}`, 0.35);
    }

    // Adjacent word pairs retain a little word order.
    for (let i = 1; i < words.length; i += 1) {
      add(vector, `b:${words[i - 1]}_${words[i]}`, 0.5);
    }

    return normalize(vector);
  }
}

function add(vector: number[], token: string, weight: number): void {
  const hash = fnv1a(token);
  const index = hash % DIMENSIONS;
  // Sign from a spare hash bit keeps unrelated collisions from always
  // accumulating constructively.
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
