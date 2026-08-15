/**
 * Structural types for the slice of the MongoDB driver this adapter uses.
 *
 * Declared locally rather than imported from `mongodb` so the project compiles
 * with zero optional dependencies installed. A user who only ever uses SQLite
 * should not need a Mongo driver on disk to run `npm run build`.
 *
 * These describe real driver behaviour, so if the shapes ever drift the
 * adapter fails at runtime with a clear error rather than silently misbehaving.
 */

export type Doc = Record<string, unknown>;

export interface FindCursor<T> {
  sort(spec: Doc): FindCursor<T>;
  limit(n: number): FindCursor<T>;
  toArray(): Promise<T[]>;
}

export interface Collection<T> {
  createIndex(spec: Doc, options?: Doc): Promise<string>;
  countDocuments(filter: Doc): Promise<number>;
  findOne(filter: Doc, options?: Doc): Promise<T | null>;
  find(filter: Doc, options?: Doc): FindCursor<T>;
  updateOne(filter: Doc, update: Doc, options?: Doc): Promise<unknown>;
  deleteMany(filter: Doc): Promise<unknown>;
  bulkWrite(operations: Doc[], options?: Doc): Promise<unknown>;
  aggregate<R>(pipeline: Doc[]): FindCursor<R>;
  listSearchIndexes(): FindCursor<Doc>;
}

export interface Db {
  command(spec: Doc): Promise<Doc>;
  collection<T>(name: string): Collection<T>;
}

export interface MongoClient {
  connect(): Promise<unknown>;
  db(name: string): Db;
  close(): Promise<void>;
}

export interface MongoModule {
  MongoClient: new (uri: string) => MongoClient;
}

/**
 * Loads the driver at runtime. The specifier is widened to `string` so
 * TypeScript does not try to resolve `mongodb` at build time, which is the
 * whole point of keeping it optional.
 */
export async function importMongo(): Promise<MongoModule> {
  try {
    const mod = (await import('mongodb' as string)) as unknown as {
      default?: MongoModule;
      MongoClient?: MongoModule['MongoClient'];
    };
    if (mod.MongoClient) return { MongoClient: mod.MongoClient };
    if (mod.default?.MongoClient) return mod.default;
    throw new Error('unexpected mongodb module shape');
  } catch {
    throw new Error('MongoDB driver not installed. Run: npm install mongodb');
  }
}
