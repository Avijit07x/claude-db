import type { Embedder } from './embedder.js';
import { normalize } from './embedder.js';

type FeatureExtractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

export class LocalEmbedder implements Embedder {
  readonly id = 'Xenova/all-MiniLM-L6-v2';
  readonly dimensions = 384;
  readonly minRelevance = 0.35;

  private pipelinePromise: Promise<FeatureExtractor> | null = null;

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extract = await this.load();
    const output = await extract(texts, { pooling: 'mean', normalize: true });
    return output.tolist().map(normalize);
  }

  private load(): Promise<FeatureExtractor> {
    this.pipelinePromise ??= (async () => {
      interface TransformersModule {
        env: { allowLocalModels: boolean };
        pipeline(task: string, model: string): Promise<unknown>;
      }
      let transformers: TransformersModule;
      try {
        transformers = (await import(
          '@xenova/transformers' as string
        )) as unknown as TransformersModule;
      } catch {
        throw new Error(
          'Local embeddings need @xenova/transformers. ' +
            'Run: npm install @xenova/transformers, or set embeddings.provider to "none".',
        );
      }
      transformers.env.allowLocalModels = false;
      return (await transformers.pipeline(
        'feature-extraction',
        this.id,
      )) as unknown as FeatureExtractor;
    })();
    return this.pipelinePromise;
  }
}
