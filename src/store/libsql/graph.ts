import type { CodeEdge, CodeSymbol, EdgeFilter, ScannedFile, SymbolFilter } from '../../types.js';
import { deleteStatements, staleDeletes, writeStatements } from './graph-write.js';
import type { GraphRows } from '../adapter.js';
import type { Client, Value } from './driver.js';
import { run, runInOrder } from './driver.js';
import { changedCount } from './rows.js';
import { toEdge, toSymbol } from '../sqlite/rows.js';

export async function upsertGraph(client: Client, scan: GraphRows): Promise<void> {
  await runInOrder(client, writeStatements(scan));
}

export async function replaceGraph(
  client: Client,
  project: string,
  files: string[] | null,
  scan: GraphRows,
): Promise<void> {
  const deletes = files !== null && files.length === 0 ? [] : staleDeletes(project, files, scan);
  await runInOrder(client, [...deletes, ...writeStatements(scan)]);
}

export async function removeGraph(
  client: Client,
  project: string,
  files?: string[],
): Promise<number> {
  const scoped = files !== undefined && files.length > 0;
  const [symbols] = await run(client, deleteStatements(project, scoped ? files : null));
  return changedCount(symbols?.rowsAffected);
}

const SYMBOL_COLUMNS = 'id, name, kind, file, line, lang, signature';
const EDGE_COLUMNS =
  'id, src_id, src_name, dst_id, dst_name, relation, confidence, score, file, line';

export async function findSymbols(client: Client, filter: SymbolFilter): Promise<CodeSymbol[]> {
  const conditions = ['project = ?'];
  const args: Value[] = [filter.project];
  if (filter.name) {
    conditions.push('name = ?');
    args.push(filter.name);
  }
  if (filter.file) {
    conditions.push('file = ?');
    args.push(filter.file);
  }
  args.push(filter.limit ?? 500);
  const res = await client.execute({
    sql: `SELECT ${SYMBOL_COLUMNS} FROM symbols WHERE ${conditions.join(' AND ')}
          ORDER BY file, line LIMIT ?`,
    args,
  });
  return res.rows.map((row) => toSymbol({ ...row, project: filter.project }));
}

export async function symbolNames(
  client: Client,
  project: string,
  limit: number,
): Promise<string[]> {
  const res = await client.execute({
    sql: 'SELECT name FROM symbols WHERE project = ? ORDER BY file, line LIMIT ?',
    args: [project, limit],
  });
  return res.rows.map((row) => row['name'] as string);
}

export async function findEdges(client: Client, filter: EdgeFilter): Promise<CodeEdge[]> {
  const args: Value[] = [filter.project];
  const listed = 'IN (SELECT value FROM json_each(?))';
  const sides: string[] = [];
  for (const [column, ids] of [
    ['src_id', filter.srcIds],
    ['dst_id', filter.dstIds],
  ] as const) {
    if (!ids || ids.length === 0) continue;
    sides.push(`${column} ${listed}`);
    args.push(JSON.stringify(ids));
  }
  for (const [side, names] of [
    ['src', filter.unresolvedSrcNames],
    ['dst', filter.unresolvedDstNames],
  ] as const) {
    if (!names || names.length === 0) continue;
    sides.push(`(${side}_id = '' AND ${side}_name ${listed})`);
    args.push(JSON.stringify(names));
  }
  let where = sides.length > 0 ? ` AND (${sides.join(' OR ')})` : '';
  if (filter.dstName !== undefined) {
    const suffix = `.${filter.dstName}`;
    where += ' AND (dst_name = ? OR substr(dst_name, -length(?)) = ?)';
    args.push(filter.dstName, suffix, suffix);
  }
  args.push(filter.limit ?? 2000);
  const res = await client.execute({
    sql: `SELECT ${EDGE_COLUMNS} FROM symbol_edges WHERE project = ?${where}
          ORDER BY file, line, id LIMIT ?`,
    args,
  });
  return res.rows.map((row) => toEdge({ ...row, project: filter.project }));
}

export async function scannedFiles(
  client: Client,
  project: string,
  limit?: number,
): Promise<ScannedFile[]> {
  const res = await client.execute({
    sql: `SELECT path, hash, scanned_at FROM scanned_files WHERE project = ?${limit === undefined ? '' : ' LIMIT ?'}`,
    args: limit === undefined ? [project] : [project, limit],
  });
  return res.rows.map((row) => ({
    project,
    path: row['path'] as string,
    hash: row['hash'] as string,
    scannedAt: Number(row['scanned_at']),
  }));
}
