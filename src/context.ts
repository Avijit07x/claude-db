import type { Config } from './config/index.js';
import { loadConfig } from './config/index.js';
import type { Embedder } from './embed/index.js';
import { createEmbedder, NoopEmbedder } from './embed/index.js';
import { SearchService } from './search/index.js';
import type { MemoryStore } from './store/adapter.js';
import { createStore } from './store/index.js';

export interface RecallContext {
  config: Config;
  store: MemoryStore;
  embedder(): Promise<Embedder>;
  search: SearchService;
  close(): Promise<void>;
}

export async function createContext(overrides?: Partial<Config>): Promise<RecallContext> {
  const config = { ...loadConfig(), ...overrides };

  const store = await createStore(config.database);
  await store.init();

  let pending: Promise<Embedder> | null = null;
  const embedder = (): Promise<Embedder> => {
    pending ??= withTimeout(
      createEmbedder(config.embeddings.provider).catch(() => new NoopEmbedder()),
      config.embeddings.timeoutMs,
    );
    return pending;
  };

  const search = new SearchService(store, embedder, config.embeddings.maxScanCandidates);

  return { config, store, embedder, search, close: () => store.close() };
}

async function withTimeout(pending: Promise<Embedder>, ms: number): Promise<Embedder> {
  if (ms <= 0) return pending;

  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<Embedder>((settle) => {
    timer = setTimeout(() => settle(new NoopEmbedder()), ms);
    timer.unref?.();
  });

  try {
    return await Promise.race([pending, limit]);
  } finally {
    clearTimeout(timer);
  }
}
