export interface Embedder {
  readonly id: string;
  readonly dimensions: number;
  readonly minRelevance: number;
  embed(texts: string[]): Promise<number[][]>;
}

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
