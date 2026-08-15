import type { Embedder } from './embedder.js';
import { normalize } from './embedder.js';

type FeatureExtractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

/**
 * all-MiniLM-L6-v2 running locally through transformers.js. No API key, no
 * per-token cost, and observations never leave the machine. The model (~25MB)
 * downloads once on first use and is cached by the library thereafter.
 *
 * The pipeline is loaded lazily and memoized: importing this module must stay
 * cheap because hook scripts import it on every tool call.
 */
export class LocalEmbedder implements Embedder {
  readonly id = 'Xenova/all-MiniLM-L6-v2';
  readonly dimensions = 384;
  // MiniLM packs unrelated sentence pairs around 0.1-0.3 and related pairs
  // above 0.4, so its noise floor sits well above the builtin's.
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
        // Widened specifier: the package is an optional peer and may be absent
        // at build time, so TypeScript must not try to resolve it.
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
