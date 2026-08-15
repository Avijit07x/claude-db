import type { Config } from './config/index.js';
import { loadConfig } from './config/index.js';
import type { Embedder } from './embed/index.js';
import { createEmbedder } from './embed/index.js';
import { SearchService } from './search/index.js';
import type { MemoryStore } from './store/adapter.js';
import { createStore } from './store/index.js';

export interface RecallContext {
  config: Config;
  store: MemoryStore;
  /** Resolves the embedder, constructing it on first use. */
  embedder(): Promise<Embedder>;
  search: SearchService;
  close(): Promise<void>;
}

/**
 * Single composition root. Everything else takes its dependencies as
 * constructor arguments, which keeps the units testable with fakes.
 *
 * The embedder is created lazily because `provider: auto` probes the model
 * with a real inference call to decide whether it works. That probe is the
 * single most expensive thing in a hook, and hooks that never embed (a trivial
 * prompt, a status query) should not pay for it.
 */
export async function createContext(overrides?: Partial<Config>): Promise<RecallContext> {
  const config = { ...loadConfig(), ...overrides };

  const store = await createStore(config.database);
  await store.init();

  let pending: Promise<Embedder> | null = null;
  const embedder = (): Promise<Embedder> => {
    pending ??= createEmbedder(config.embeddings.provider);
    return pending;
  };

  const search = new SearchService(store, embedder, config.embeddings.maxScanCandidates);

  return { config, store, embedder, search, close: () => store.close() };
}
