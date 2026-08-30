import type { Pool } from './driver.js';
import type { CodeEdge, CodeSymbol, EdgeFilter, ScannedFile, SymbolFilter } from '../../types.js';
import { toEdge, toSymbol } from './rows.js';

const CHUNK = 500;

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
  client: { query: (text: string, values: unknown[]) => Promise<unknown> },
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

export async function upsertGraph(
  pool: Pool,
  scan: {
    symbols: CodeSymbol[];
    edges: CodeEdge[];
    files: ScannedFile[];
  },
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

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
    `SELECT * FROM symbols WHERE ${conditions.join(' AND ')}
       ORDER BY file, line LIMIT $${values.length}`,
    values,
  );
  return res.rows.map(toSymbol);
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
  let where = sides.length > 0 ? ` AND (${sides.join(' OR ')})` : '';
  if (filter.dstName !== undefined) {
    values.push(filter.dstName, `%.${filter.dstName}`);
    where += ` AND (dst_name = $${values.length - 1} OR dst_name LIKE $${values.length})`;
  }
  values.push(filter.limit ?? 2000);

  const res = await pool.query(
    `SELECT * FROM symbol_edges WHERE project = $1${where}
       ORDER BY file, line, id LIMIT $${values.length}`,
    values,
  );
  return res.rows.map(toEdge);
}

export async function scannedFiles(pool: Pool, project: string): Promise<ScannedFile[]> {
  const res = await pool.query('SELECT * FROM scanned_files WHERE project = $1', [project]);
  return res.rows.map((row) => ({
    project: row['project'] as string,
    path: row['path'] as string,
    hash: row['hash'] as string,
    scannedAt: Number(row['scanned_at']),
  }));
}

export async function removeGraph(pool: Pool, project: string, files?: string[]): Promise<number> {
  const scoped = files !== undefined && files.length > 0;
  const values: unknown[] = scoped ? [project, files] : [project];
  const where = scoped ? 'project = $1 AND file = ANY($2::text[])' : 'project = $1';
  const cacheWhere = scoped ? 'project = $1 AND path = ANY($2::text[])' : 'project = $1';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const counted = await client.query(
      `SELECT COUNT(*)::int AS n FROM symbols WHERE ${where}`,
      values,
    );
    await client.query(`DELETE FROM symbols WHERE ${where}`, values);
    await client.query(`DELETE FROM symbol_edges WHERE ${where}`, values);
    await client.query(`DELETE FROM scanned_files WHERE ${cacheWhere}`, values);
    await client.query('COMMIT');
    return Number(counted.rows[0]?.['n'] ?? 0);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
