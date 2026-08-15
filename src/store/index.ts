import type { MemoryStore } from './adapter.js';

export type { MemoryStore, StoreFactory } from './adapter.js';

/**
 * Resolve a store from a connection URI. The scheme alone decides the backend,
 * so users configure one variable and never name an adapter explicitly.
 *
 *   mongodb://... | mongodb+srv://...  -> MongoDB
 *   postgres://... | postgresql://...  -> Postgres + pgvector
 *   sqlite:///abs/path | ./file.db     -> SQLite (default)
 *
 * Adapters are imported lazily so a user on Mongo never loads the Postgres
 * driver, and a missing optional dependency surfaces as a clear message.
 */
export async function createStore(uri: string): Promise<MemoryStore> {
  const scheme = parseScheme(uri);

  switch (scheme) {
    case 'mongodb':
    case 'mongodb+srv': {
      const { MongoStore } = await import('./mongo/index.js');
      return MongoStore.create(uri);
    }
    case 'postgres':
    case 'postgresql': {
      const { PostgresStore } = await import('./postgres/index.js');
      return PostgresStore.create(uri);
    }
    case 'sqlite':
    case 'file':
    case '': {
      const { SqliteStore } = await import('./sqlite/index.js');
      return SqliteStore.create(uri);
    }
    default:
      throw new Error(
        `Unsupported database scheme "${scheme}". ` +
          `Use mongodb://, postgres://, or a sqlite file path.`,
      );
  }
}

function parseScheme(uri: string): string {
  const match = /^([a-z0-9+.-]+):\/\//i.exec(uri.trim());
  return match?.[1]?.toLowerCase() ?? '';
}
