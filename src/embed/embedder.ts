/**
 * Turns text into a normalized vector. Implementations must return unit-length
 * vectors so downstream similarity is a plain dot product.
 */
export interface Embedder {
  readonly id: string;
  readonly dimensions: number;
  /**
   * Cosine similarity below which a match is indistinguishable from noise.
   *
   * This belongs to the model, not to the search code: different embedding
   * spaces have wildly different baselines. Measured on this codebase, the
   * builtin hashing embedder scores unrelated text up to 0.135 and related
   * text from 0.235, so its floor sits in that gap. Sentence transformers
   * have a much higher baseline and need a correspondingly higher floor.
   */
  readonly minRelevance: number;
  embed(texts: string[]): Promise<number[][]>;
}

/** Used when embeddings are disabled. Search falls back to keyword-only. */
export class NoopEmbedder implements Embedder {
  readonly id = 'none';
  readonly dimensions = 0;
  readonly minRelevance = 0;
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => []);
  }
}

export function normalize(vector: number[]): number[] {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const magnitude = Math.sqrt(sum);
  if (magnitude === 0) return vector;
  return vector.map((value) => value / magnitude);
}
