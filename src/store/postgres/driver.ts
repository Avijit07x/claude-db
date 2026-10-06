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
}

export interface PgModule {
  Pool: new (config: { connectionString: string }) => Pool;
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
