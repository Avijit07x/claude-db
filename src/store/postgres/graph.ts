import type { Pool, PoolClient, QueryResult } from './driver.js';
import type { CodeEdge, CodeSymbol, EdgeFilter, ScannedFile, SymbolFilter } from '../../types.js';
import { toEdge, toSymbol } from './rows.js';
import type { GraphRows } from '../adapter.js';

const CHUNK = 500;

type Client = { query: (text: string, values?: unknown[]) => Promise<QueryResult> };

function lastById<T>(rows: T[], key: (row: T) => string): T[] {
  const byId = new Map<string, T>();
  for (const row of rows) byId.set(key(row), row);
  return [...byId.values()];
}

function placeholders(count: number, width: number): string {
  const groups: string[] = [];
  for (let row = 0; row < count; row += 1) {
    const holes: string[] = [];
    for (let col = 1; col <= width; col += 1) holes.push(`$${row * width + col}`);
    groups.push(`(${holes.join(', ')})`);
  }
  return groups.join(', ');
}

async function upsertChunked<T>(
  client: Client,
  rows: T[],
  width: number,
  sql: (values: string) => string,
  columns: (row: T) => unknown[],
): Promise<void> {
  for (let start = 0; start < rows.length; start += CHUNK) {
    const slice = rows.slice(start, start + CHUNK);
    const values: unknown[] = [];
    for (const row of slice) values.push(...columns(row));
    await client.query(sql(placeholders(slice.length, width)), values);
  }
}

async function writeGraphRows(client: Client, scan: GraphRows): Promise<void> {
  await upsertChunked(
    client,
    lastById(scan.symbols, (s) => s.id),
    8,
    (values) => `INSERT INTO symbols (id, project, name, kind, file, line, lang, signature)
         VALUES ${values}
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, kind = EXCLUDED.kind, file = EXCLUDED.file,
           line = EXCLUDED.line, lang = EXCLUDED.lang,
           signature = EXCLUDED.signature`,
    (s) => [s.id, s.project, s.name, s.kind, s.file, s.line, s.lang, s.signature],
  );

  await upsertChunked(
    client,
    lastById(scan.edges, (e) => e.id),
    11,
    (values) => `INSERT INTO symbol_edges (id, project, src_id, src_name, dst_id, dst_name,
                                   relation, confidence, score, file, line)
         VALUES ${values}
         ON CONFLICT (id) DO UPDATE SET
           dst_id = EXCLUDED.dst_id, dst_name = EXCLUDED.dst_name,
           relation = EXCLUDED.relation, confidence = EXCLUDED.confidence,
           score = EXCLUDED.score, file = EXCLUDED.file, line = EXCLUDED.line`,
    (e) => [
      e.id,
      e.project,
      e.srcId,
      e.srcName,
      e.dstId,
      e.dstName,
      e.relation,
      e.confidence,
      e.score,
      e.file,
      e.line,
    ],
  );

  await upsertChunked(
    client,
    lastById(scan.files, (f) => `${f.project}\u0000${f.path}`),
    4,
    (values) => `INSERT INTO scanned_files (project, path, hash, scanned_at)
         VALUES ${values}
         ON CONFLICT (project, path) DO UPDATE SET
           hash = EXCLUDED.hash, scanned_at = EXCLUDED.scanned_at`,
    (f) => [f.project, f.path, f.hash, f.scannedAt],
  );
}

async function deleteGraphRows(
  client: Client,
  project: string,
  files: string[] | null,
): Promise<number> {
  if (files !== null && files.length === 0) return 0;
  const values: unknown[] = files === null ? [project] : [project, files];
  const where = files === null ? 'project = $1' : 'project = $1 AND file = ANY($2::text[])';
  const cacheWhere = files === null ? 'project = $1' : 'project = $1 AND path = ANY($2::text[])';
  const res = await client.query(
    `WITH gone AS (DELETE FROM symbols WHERE ${where} RETURNING 1),
          edges AS (DELETE FROM symbol_edges WHERE ${where}),
          cached AS (DELETE FROM scanned_files WHERE ${cacheWhere})
     SELECT COUNT(*)::int AS n FROM gone`,
    values,
  );
  return Number(res.rows[0]?.['n'] ?? 0);
}

async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function upsertGraph(pool: Pool, scan: GraphRows): Promise<void> {
  await inTransaction(pool, (client) => writeGraphRows(client, scan));
}

export async function replaceGraph(
  pool: Pool,
  project: string,
  files: string[] | null,
  scan: GraphRows,
): Promise<void> {
  await inTransaction(pool, async (client) => {
    await deleteGraphRows(client, project, files);
    await writeGraphRows(client, scan);
  });
}

const SYMBOL_COLUMNS = 'id, name, kind, file, line, lang, signature';
const EDGE_COLUMNS =
  'id, src_id, src_name, dst_id, dst_name, relation, confidence, score, file, line';

export async function findSymbols(pool: Pool, filter: SymbolFilter): Promise<CodeSymbol[]> {
  const values: unknown[] = [filter.project];
  const conditions = ['project = $1'];
  if (filter.name) {
    values.push(filter.name);
    conditions.push(`name = $${values.length}`);
  }
  if (filter.file) {
    values.push(filter.file);
    conditions.push(`file = $${values.length}`);
  }
  values.push(filter.limit ?? 500);

  const res = await pool.query(
    `SELECT ${SYMBOL_COLUMNS} FROM symbols WHERE ${conditions.join(' AND ')}
       ORDER BY file, line LIMIT $${values.length}`,
    values,
  );
  return res.rows.map((row) => toSymbol({ ...row, project: filter.project }));
}

export async function symbolNames(pool: Pool, project: string, limit: number): Promise<string[]> {
  const res = await pool.query(
    'SELECT name FROM symbols WHERE project = $1 ORDER BY file, line LIMIT $2',
    [project, limit],
  );
  return res.rows.map((row) => row['name'] as string);
}

export async function findEdges(pool: Pool, filter: EdgeFilter): Promise<CodeEdge[]> {
  const values: unknown[] = [filter.project];
  const sides: string[] = [];
  for (const [column, ids] of [
    ['src_id', filter.srcIds],
    ['dst_id', filter.dstIds],
  ] as const) {
    if (!ids || ids.length === 0) continue;
    values.push(ids);
    sides.push(`${column} = ANY($${values.length}::text[])`);
  }
  for (const [side, names] of [
    ['src', filter.unresolvedSrcNames],
    ['dst', filter.unresolvedDstNames],
  ] as const) {
    if (!names || names.length === 0) continue;
    values.push(names);
    sides.push(`(${side}_id = '' AND ${side}_name = ANY($${values.length}::text[]))`);
  }
  let where = sides.length > 0 ? ` AND (${sides.join(' OR ')})` : '';
  if (filter.dstName !== undefined) {
    values.push(filter.dstName, `%.${filter.dstName}`);
    where += ` AND (dst_name = $${values.length - 1} OR dst_name LIKE $${values.length})`;
  }
  values.push(filter.limit ?? 2000);

  const res = await pool.query(
    `SELECT ${EDGE_COLUMNS} FROM symbol_edges WHERE project = $1${where}
       ORDER BY file, line, id LIMIT $${values.length}`,
    values,
  );
  return res.rows.map((row) => toEdge({ ...row, project: filter.project }));
}

export async function scannedFiles(
  pool: Pool,
  project: string,
  limit?: number,
): Promise<ScannedFile[]> {
  const res = await pool.query(
    `SELECT path, hash, scanned_at FROM scanned_files WHERE project = $1${limit === undefined ? '' : ' LIMIT $2'}`,
    limit === undefined ? [project] : [project, limit],
  );
  return res.rows.map((row) => ({
    project,
    path: row['path'] as string,
    hash: row['hash'] as string,
    scannedAt: Number(row['scanned_at']),
  }));
}

export async function removeGraph(pool: Pool, project: string, files?: string[]): Promise<number> {
  const scoped = files !== undefined && files.length > 0;
  return deleteGraphRows(pool, project, scoped ? files : null);
}
