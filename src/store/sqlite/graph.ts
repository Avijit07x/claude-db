import type { DatabaseSync } from 'node:sqlite';
import type { CodeEdge, CodeSymbol, EdgeFilter, ScannedFile, SymbolFilter } from '../../types.js';
import type { Row } from './rows.js';
import { toEdge, toSymbol } from './rows.js';

export async function upsertGraph(
  db: DatabaseSync,
  scan: {
    symbols: CodeSymbol[];
    edges: CodeEdge[];
    files: ScannedFile[];
  },
): Promise<void> {
  const symbol = db.prepare(
    `INSERT OR REPLACE INTO symbols
         (id, project, name, kind, file, line, lang, signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const edge = db.prepare(
    `INSERT OR REPLACE INTO symbol_edges
         (id, project, src_id, src_name, dst_id, dst_name,
          relation, confidence, score, file, line)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const file = db.prepare(
    `INSERT OR REPLACE INTO scanned_files (project, path, hash, scanned_at)
       VALUES (?, ?, ?, ?)`,
  );

  db.exec('BEGIN');
  try {
    for (const s of scan.symbols) {
      symbol.run(s.id, s.project, s.name, s.kind, s.file, s.line, s.lang, s.signature);
    }
    for (const e of scan.edges) {
      edge.run(
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
      );
    }
    for (const f of scan.files) {
      file.run(f.project, f.path, f.hash, f.scannedAt);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export async function findSymbols(db: DatabaseSync, filter: SymbolFilter): Promise<CodeSymbol[]> {
  const conditions = ['project = ?'];
  const params: unknown[] = [filter.project];
  if (filter.name) {
    conditions.push('name = ?');
    params.push(filter.name);
  }
  if (filter.file) {
    conditions.push('file = ?');
    params.push(filter.file);
  }
  params.push(filter.limit ?? 500);

  const rows = db
    .prepare(
      `SELECT * FROM symbols WHERE ${conditions.join(' AND ')}
         ORDER BY file, line LIMIT ?`,
    )
    .all(...(params as never[])) as Row[];
  return rows.map(toSymbol);
}

export async function findEdges(db: DatabaseSync, filter: EdgeFilter): Promise<CodeEdge[]> {
  const params: unknown[] = [filter.project];
  const sides: string[] = [];
  for (const [column, ids] of [
    ['src_id', filter.srcIds],
    ['dst_id', filter.dstIds],
  ] as const) {
    if (!ids || ids.length === 0) continue;
    sides.push(`${column} IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  const where = sides.length > 0 ? ` AND (${sides.join(' OR ')})` : '';
  params.push(filter.limit ?? 2000);

  const rows = db
    .prepare(`SELECT * FROM symbol_edges WHERE project = ?${where} LIMIT ?`)
    .all(...(params as never[])) as Row[];
  return rows.map(toEdge);
}

export async function scannedFiles(db: DatabaseSync, project: string): Promise<ScannedFile[]> {
  const rows = db.prepare('SELECT * FROM scanned_files WHERE project = ?').all(project) as Row[];
  return rows.map((row) => ({
    project: row['project'] as string,
    path: row['path'] as string,
    hash: row['hash'] as string,
    scannedAt: row['scanned_at'] as number,
  }));
}

export async function removeGraph(
  db: DatabaseSync,
  project: string,
  files?: string[],
): Promise<number> {
  const scoped = files && files.length > 0;
  const where = scoped
    ? `project = ? AND file IN (${files.map(() => '?').join(',')})`
    : 'project = ?';
  const params = scoped ? [project, ...files] : [project];

  const count = db
    .prepare(`SELECT COUNT(*) AS n FROM symbols WHERE ${where}`)
    .get(...(params as never[])) as { n: number } | undefined;

  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM symbols WHERE ${where}`).run(...(params as never[]));
    db.prepare(`DELETE FROM symbol_edges WHERE ${where}`).run(...(params as never[]));
    const cacheWhere = scoped
      ? `project = ? AND path IN (${files.map(() => '?').join(',')})`
      : 'project = ?';
    db.prepare(`DELETE FROM scanned_files WHERE ${cacheWhere}`).run(...(params as never[]));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return count?.n ?? 0;
}
