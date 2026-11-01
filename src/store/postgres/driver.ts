export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number | null;
}

export interface PoolClient {
  query(sql: string, values?: unknown[]): Promise<QueryResult>;
  release(): void;
}

export interface Pool {
  query(sql: string, values?: unknown[]): Promise<QueryResult>;
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

export interface PoolConfig {
  connectionString: string;
  max?: number;
  idleTimeoutMillis?: number;
  allowExitOnIdle?: boolean;
  keepAlive?: boolean;
}

export interface PgModule {
  Pool: new (config: PoolConfig) => Pool;
}

const PG: string = 'pg';

export async function importPg(): Promise<PgModule> {
  try {
    const mod = (await import(PG)) as {
      default?: PgModule;
      Pool?: PgModule['Pool'];
    };
    if (mod.default?.Pool) return mod.default;
    if (mod.Pool) return { Pool: mod.Pool };
    throw new Error('unexpected pg module shape');
  } catch {
    throw new Error('Postgres driver not installed. Run: npm install -g pg');
  }
}

export async function openPool(uri: string): Promise<Pool> {
  const pg = await importPg();
  const pool = new pg.Pool({
    connectionString: uri,
    max: 4,
    idleTimeoutMillis: 60_000,
    allowExitOnIdle: true,
    keepAlive: true,
  });
  pool.on('error', () => undefined);
  return pool;
}
