import type { Config } from './config/index.js';
import { loadConfig } from './config/index.js';
import type { Embedder } from './embed/index.js';
import { createEmbedder, NoopEmbedder } from './embed/index.js';
import { SearchService } from './search/index.js';
import type { MemoryStore } from './store/adapter.js';
import { createStore } from './store/index.js';
import { createScopeResolver } from './store/project-resolver.js';
import { withProjectScope } from './store/scoped-store.js';

export interface RecallContext {
  config: Config;
  store: MemoryStore;
  embedder(): Promise<Embedder>;
  search: SearchService;
  close(): Promise<void>;
}

export async function createContext(overrides?: Partial<Config>): Promise<RecallContext> {
  const config = { ...loadConfig(), ...overrides };

  const raw = await createStore(config.database);
  await raw.init();
  const store = withProjectScope(
    raw,
    createScopeResolver({ store: raw, remote: config.project.remote }),
  );

  const embedder = embedderWithDeadline(
    () => createEmbedder(config.embeddings.provider),
    config.embeddings.timeoutMs,
  );

  const search = new SearchService(store, embedder, config.embeddings.maxScanCandidates);

  return { config, store, embedder, search, close: () => store.close() };
}

export function embedderWithDeadline(
  load: () => Promise<Embedder>,
  timeoutMs: number,
  now: () => number = Date.now,
): () => Promise<Embedder> {
  let loading: Promise<Embedder> | null = null;
  let ready: Embedder | null = null;
  let deadline = 0;

  return () => {
    if (ready) return Promise.resolve(ready);
    if (!loading) {
      deadline = now() + timeoutMs;
      loading = load().catch(() => new NoopEmbedder());
      void loading.then((embedder) => {
        ready = embedder;
      });
    }
    if (timeoutMs <= 0) return loading;
    return withTimeout(loading, deadline - now());
  };
}

async function withTimeout(pending: Promise<Embedder>, ms: number): Promise<Embedder> {
  if (ms <= 0) return Promise.race([pending, Promise.resolve(new NoopEmbedder())]);

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
