import type { Embedder } from './embedder.js';
import { NoopEmbedder } from './embedder.js';
import { BuiltinEmbedder } from './builtin.js';

export type { Embedder } from './embedder.js';
export { NoopEmbedder, normalize } from './embedder.js';
export { BuiltinEmbedder } from './builtin.js';

export type EmbeddingProvider = 'auto' | 'local' | 'builtin' | 'none';

/**
 * `auto` is the default and the reason zero-config installs still get fuzzy
 * recall: it prefers the real sentence-transformer, but a missing or broken
 * ONNX runtime silently falls back to the builtin rather than leaving the
 * user with keyword-only search and no explanation.
 *
 * The probe runs one real embedding, because importing the module succeeds in
 * cases where the native backend still fails at inference time.
 */
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
