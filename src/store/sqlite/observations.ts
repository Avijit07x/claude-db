import type { DatabaseSync } from 'node:sqlite';
import type { ListFilter, Observation, RemoveFilter } from '../../types.js';
import type { ProjectSummary } from '../adapter.js';
import { foreignNames, isWholeScope } from '../adapter.js';
import type { Row } from './rows.js';
import { toObservation } from './rows.js';
import { removeWhere } from './filters.js';
import { partitionIds } from '../../util/shortid.js';
import { packVector } from '../../util/vector.js';
import { scopeToken } from '../../util/scope.js';

export async function insertObservations(
  db: DatabaseSync,
  observations: Observation[],
): Promise<void> {
  if (observations.length === 0) return;

  const stmt = db.prepare(
    `INSERT OR REPLACE INTO observations
        (id, session_id, project, scope, kind, title, body, files, tags,
         created_at, embedding, embedder, author, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  db.exec('BEGIN');
  try {
    for (const obs of observations) {
      stmt.run(
        obs.id,
        obs.sessionId,
        obs.project,
        scopeToken(obs.project),
        obs.kind,
        obs.title,
        obs.body,
        JSON.stringify(obs.files),
        JSON.stringify(obs.tags),
        obs.createdAt,
        obs.embedding ? packVector(obs.embedding) : null,
        obs.embedder ?? null,
        obs.author ?? null,
        obs.status ?? 'done',
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export async function getObservations(db: DatabaseSync, ids: string[]): Promise<Observation[]> {
  if (ids.length === 0) return [];
  const { exact, prefixes } = partitionIds(ids);

  const clauses: string[] = [];
  const params: unknown[] = [];

  if (exact.length > 0) {
    clauses.push(`id IN (${exact.map(() => '?').join(',')})`);
    params.push(...exact);
  }
  for (const prefix of prefixes) {
    clauses.push('id GLOB ?');
    params.push(`${prefix}*`);
  }

  const rows = db
    .prepare(`SELECT * FROM observations WHERE ${clauses.join(' OR ')}`)
    .all(...(params as never[])) as Row[];
  return rows.map(toObservation);
}

export async function remove(db: DatabaseSync, filter: RemoveFilter): Promise<number> {
  if (filter.ids?.length === 0) return 0;

  const { where, params } = removeWhere(filter);
  const wipe = isWholeScope(filter);

  const count = db
    .prepare(`SELECT COUNT(*) AS n FROM observations ${where}`)
    .get(...(params as never[])) as { n: number } | undefined;

  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM observations ${where}`).run(...(params as never[]));
    if (wipe) {
      const scope = filter.project ? 'WHERE project = ?' : '';
      const scopeParams = (filter.project ? [filter.project] : []) as never[];
      db.prepare(`DELETE FROM sessions ${scope}`).run(...scopeParams);
      for (const table of ['symbols', 'symbol_edges', 'scanned_files']) {
        db.prepare(`DELETE FROM ${table} ${scope}`).run(...scopeParams);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  if (wipe) db.exec('VACUUM');
  return count?.n ?? 0;
}

export async function list(db: DatabaseSync, filter: ListFilter): Promise<Observation[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.project) {
    conditions.push('project = ?');
    params.push(filter.project);
  }
  if (filter.kind) {
    conditions.push('kind = ?');
    params.push(filter.kind);
  }
  if (filter.status) {
    conditions.push('status = ?');
    params.push(filter.status);
  }
  if (filter.after !== undefined) {
    conditions.push('created_at > ?');
    params.push(filter.after);
  }
  params.push(filter.limit ?? 1000);

  const rows = db
    .prepare(
      `SELECT * FROM observations
         ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
         ORDER BY created_at ASC LIMIT ?`,
    )
    .all(...(params as never[])) as Row[];
  return rows.map(toObservation);
}

export async function listProjects(db: DatabaseSync): Promise<ProjectSummary[]> {
  const rows = db
    .prepare(
      `SELECT project, COUNT(*) AS n, MAX(created_at) AS last
         FROM observations GROUP BY project ORDER BY last DESC`,
    )
    .all() as Row[];

  return rows.map((row) => ({
    project: row['project'] as string,
    observations: Number(row['n']),
    lastActive: Number(row['last']),
  }));
}

export async function inventory(db: DatabaseSync): Promise<string[]> {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master
         WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'`,
    )
    .all() as Row[];
  return foreignNames(rows.map((row) => String(row['name'] ?? '')));
}

export async function closeObservations(db: DatabaseSync, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const holes = ids.map(() => '?').join(',');
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM observations WHERE status = 'open' AND id IN (${holes})`)
    .get(...(ids as never[])) as { n: number } | undefined;
  db.prepare(`UPDATE observations SET status = 'done' WHERE id IN (${holes})`).run(
    ...(ids as never[]),
  );
  return row?.n ?? 0;
}
