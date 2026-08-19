import type { Embedder } from './embedder.js';
import { NoopEmbedder } from './embedder.js';
import { BuiltinEmbedder } from './builtin.js';

export type { Embedder } from './embedder.js';
export { NoopEmbedder, normalize } from './embedder.js';
export { BuiltinEmbedder } from './builtin.js';

export type EmbeddingProvider = 'auto' | 'local' | 'builtin' | 'none';

export async function createEmbedder(provider: EmbeddingProvider): Promise<Embedder> {
  switch (provider) {
    case 'none':
      return new NoopEmbedder();
    case 'builtin':
      return new BuiltinEmbedder();
    case 'local':
      return loadLocal();
    case 'auto':
      return (await tryLoadLocal()) ?? new BuiltinEmbedder();
  }
}

async function loadLocal(): Promise<Embedder> {
  const { LocalEmbedder } = await import('./local.js');
  return new LocalEmbedder();
}

async function tryLoadLocal(): Promise<Embedder | null> {
  try {
    const embedder = await loadLocal();
    const [probe] = await embedder.embed(['probe']);
    return probe && probe.length > 0 ? embedder : null;
  } catch {
    return null;
  }
}
