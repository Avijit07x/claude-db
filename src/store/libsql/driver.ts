export type Value = null | string | number | bigint | boolean | ArrayBuffer | Uint8Array;

export interface Statement {
  sql: string;
  args: Value[];
}

export type Row = Record<string, unknown>;

export interface ResultSet {
  rows: Row[];
  rowsAffected: number;
}

export interface Client {
  execute(statement: Statement): Promise<ResultSet>;
  batch(statements: Statement[], mode: 'write' | 'read' | 'deferred'): Promise<ResultSet[]>;
  close(): void;
}

interface LibsqlModule {
  createClient(config: { url: string }): Client;
}

const WEB_CLIENT: string = '@libsql/client/web';

export async function importLibsql(): Promise<LibsqlModule> {
  try {
    const mod = (await import(WEB_CLIENT)) as Partial<LibsqlModule> & {
      default?: Partial<LibsqlModule>;
    };
    const createClient = mod.createClient ?? mod.default?.createClient;
    if (!createClient) throw new Error('unexpected @libsql/client module shape');
    return { createClient };
  } catch {
    throw new Error('Turso/libSQL driver not installed. Run: npm install -g @libsql/client');
  }
}

export async function openClient(uri: string): Promise<Client> {
  const libsql = await importLibsql();
  return libsql.createClient({ url: uri });
}

export async function run(client: Client, statements: Statement[]): Promise<ResultSet[]> {
  const [only] = statements;
  if (statements.length === 1 && only) return [await client.execute(only)];
  if (statements.length === 0) return [];
  return client.batch(statements, 'write');
}

const ONE_REQUEST_BYTES = 32 * 1024 * 1024;

function bytes(statement: Statement): number {
  return statement.args.reduce<number>(
    (total, arg) => total + (typeof arg === 'string' ? Buffer.byteLength(arg) : 16),
    Buffer.byteLength(statement.sql),
  );
}

export async function runInOrder(client: Client, statements: Statement[]): Promise<ResultSet[]> {
  const total = statements.reduce((sum, statement) => sum + bytes(statement), 0);
  if (total <= ONE_REQUEST_BYTES) return run(client, statements);

  const results: ResultSet[] = [];
  let chunk: Statement[] = [];
  let size = 0;
  for (const statement of statements) {
    if (chunk.length > 0 && size + bytes(statement) > ONE_REQUEST_BYTES / 2) {
      results.push(...(await run(client, chunk)));
      chunk = [];
      size = 0;
    }
    chunk.push(statement);
    size += bytes(statement);
  }
  results.push(...(await run(client, chunk)));
  return results;
}
