import type { Pool } from './driver.js';
import type {
  ListFilter,
  Observation,
  ObservationIndexEntry,
  RemoveFilter,
  TimelineQuery,
} from '../../types.js';
import type { ProjectSummary } from '../adapter.js';
import { foreignNames, isWholeScope } from '../adapter.js';
import { partitionIds } from '../../util/shortid.js';
import { toIndexEntry, toObservation } from './rows.js';

export async function getObservations(pool: Pool, ids: string[]): Promise<Observation[]> {
  if (ids.length === 0) return [];
  const { exact, prefixes } = partitionIds(ids);

  const clauses: string[] = [];
  const values: unknown[] = [];

  if (exact.length > 0) {
    values.push(exact);
    clauses.push(`id = ANY($${values.length}::text[])`);
  }
  for (const prefix of prefixes) {
    values.push(`${prefix.replace(/[%_]/g, '')}%`);
    clauses.push(`id LIKE $${values.length}`);
  }

  const res = await pool.query(`SELECT * FROM observations WHERE ${clauses.join(' OR ')}`, values);
  return res.rows.map(toObservation);
}

export async function remove(pool: Pool, filter: RemoveFilter): Promise<number> {
  if (filter.ids?.length === 0) return 0;

  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filter.ids) {
    const { exact, prefixes } = partitionIds(filter.ids);
    const alternatives: string[] = [];
    if (exact.length > 0) {
      values.push(exact);
      alternatives.push(`id = ANY($${values.length}::text[])`);
    }
    for (const prefix of prefixes) {
      values.push(`${prefix.replace(/[%_]/g, '')}%`);
      alternatives.push(`id LIKE $${values.length}`);
    }
    conditions.push(`(${alternatives.join(' OR ')})`);
  }
  if (filter.project) {
    values.push(filter.project);
    conditions.push(`project = $${values.length}`);
  }
  if (filter.kind) {
    values.push(filter.kind);
    conditions.push(`kind = $${values.length}`);
  }
  if (filter.before !== undefined) {
    values.push(filter.before);
    conditions.push(`created_at < $${values.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const counted = await client.query(
      `SELECT COUNT(*)::int AS n FROM observations ${where}`,
      values,
    );
    await client.query(`DELETE FROM observations ${where}`, values);
    if (isWholeScope(filter)) {
      const scope = filter.project ? 'WHERE project = $1' : '';
      const scopeValues = filter.project ? [filter.project] : [];
      for (const table of ['sessions', 'symbols', 'symbol_edges', 'scanned_files']) {
        await client.query(`DELETE FROM ${table} ${scope}`, scopeValues);
      }
    }
    await client.query('COMMIT');
    return Number(counted.rows[0]?.['n'] ?? 0);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function list(pool: Pool, filter: ListFilter): Promise<Observation[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filter.project) {
    values.push(filter.project);
    conditions.push(`project = $${values.length}`);
  }
  if (filter.kind) {
    values.push(filter.kind);
    conditions.push(`kind = $${values.length}`);
  }
  if (filter.status) {
    values.push(filter.status);
    conditions.push(`status = $${values.length}`);
  }
  if (filter.after !== undefined) {
    values.push(filter.after);
    conditions.push(`created_at > $${values.length}`);
  }
  values.push(filter.limit ?? 1000);

  const res = await pool.query(
    `SELECT * FROM observations
       ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY created_at ASC LIMIT $${values.length}`,
    values,
  );
  return res.rows.map(toObservation);
}

export async function listProjects(pool: Pool): Promise<ProjectSummary[]> {
  const res = await pool.query(
    `SELECT project, COUNT(*)::int AS n, MAX(created_at) AS last
       FROM observations GROUP BY project ORDER BY last DESC`,
  );
  return res.rows.map((row) => ({
    project: row['project'] as string,
    observations: Number(row['n']),
    lastActive: Number(row['last']),
  }));
}

export async function inventory(pool: Pool): Promise<string[]> {
  const res = await pool.query(
    `SELECT tablename AS name FROM pg_tables
       WHERE schemaname = ANY(current_schemas(false))`,
  );
  return foreignNames(res.rows.map((row) => String(row['name'] ?? '')));
}

export async function timeline(pool: Pool, query: TimelineQuery): Promise<ObservationIndexEntry[]> {
  const anchorRes = await pool.query('SELECT project, created_at FROM observations WHERE id = $1', [
    query.observationId,
  ]);
  const anchor = anchorRes.rows[0];
  if (!anchor) return [];

  const res = await pool.query(
    `(SELECT id, kind, title, project, created_at, 0 AS score
        FROM observations
        WHERE project = $1 AND created_at <= $2
        ORDER BY created_at DESC LIMIT $3)
       UNION
       (SELECT id, kind, title, project, created_at, 0 AS score
        FROM observations
        WHERE project = $1 AND created_at > $2
        ORDER BY created_at ASC LIMIT $4)
       ORDER BY created_at ASC`,
    [anchor.project, anchor.created_at, query.before + 1, query.after],
  );
  return res.rows.map(toIndexEntry);
}

export async function closeObservations(pool: Pool, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const res = await pool.query(
    `UPDATE observations SET status = 'done'
     WHERE status = 'open' AND id = ANY($1::text[])`,
    [ids],
  );
  return res.rowCount ?? 0;
}
