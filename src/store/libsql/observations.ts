import type { CountFilter, ListFilter, Observation, RemoveFilter } from '../../types.js';
import type { ProjectSummary } from '../adapter.js';
import { foreignNames, isWholeScope } from '../adapter.js';
import type { Client, Statement, Value } from './driver.js';
import { run } from './driver.js';
import { COLUMNS, WITHOUT_BODY, changedCount, toObservation } from './rows.js';
import {
  TAG_PREDICATE,
  excludeSessionsClause,
  globPrefix,
  projectClause,
  removeWhere,
} from '../sqlite/filters.js';
import { partitionIds } from '../../util/shortid.js';
import { noProjects } from '../project-scope.js';

function listColumns(filter: ListFilter): string {
  if (filter.vectors) return `${COLUMNS}, embedding`;
  return filter.bodies === false ? WITHOUT_BODY : COLUMNS;
}

export async function getObservations(client: Client, ids: string[]): Promise<Observation[]> {
  if (ids.length === 0) return [];
  const { exact, prefixes } = partitionIds(ids);

  const clauses: string[] = [];
  const args: Value[] = [];
  if (exact.length > 0) {
    clauses.push('id IN (SELECT value FROM json_each(?))');
    args.push(JSON.stringify(exact));
  }
  for (const prefix of prefixes) {
    clauses.push('id GLOB ?');
    args.push(globPrefix(prefix));
  }

  const res = await client.execute({
    sql: `SELECT ${COLUMNS} FROM observations WHERE ${clauses.join(' OR ')}`,
    args,
  });
  return res.rows.map(toObservation);
}

export async function remove(client: Client, filter: RemoveFilter): Promise<number> {
  if (noProjects(filter.project)) return 0;
  if (filter.ids?.length === 0) return 0;

  const { where, params } = removeWhere(filter);
  const args = params as Value[];
  const statements: Statement[] = [{ sql: `DELETE FROM observations ${where}`, args }];
  if (isWholeScope(filter)) {
    const scopeParams: unknown[] = [];
    const clause = projectClause('project', filter.project, scopeParams);
    const scope = clause ? `WHERE ${clause}` : '';
    for (const table of ['sessions', 'symbols', 'symbol_edges', 'scanned_files']) {
      statements.push({ sql: `DELETE FROM ${table} ${scope}`, args: scopeParams as Value[] });
    }
  }
  const [deleted] = await run(client, statements);
  return changedCount(deleted?.rowsAffected);
}

function scopeConditions(filter: CountFilter, params: unknown[]): string[] {
  const conditions: string[] = [];
  const project = projectClause('project', filter.project, params);
  if (project) conditions.push(project);
  if (filter.sessionId) {
    conditions.push('session_id = ?');
    params.push(filter.sessionId);
  }
  const excluded = excludeSessionsClause('session_id', filter.excludeSessions, params);
  if (excluded) conditions.push(excluded);
  if (filter.kind) {
    conditions.push('kind = ?');
    params.push(filter.kind);
  }
  if (filter.status) {
    conditions.push('status = ?');
    params.push(filter.status);
  }
  if (filter.tag) {
    conditions.push(TAG_PREDICATE(''));
    params.push(filter.tag);
  }
  return conditions;
}

function where(conditions: string[]): string {
  return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
}

export async function list(client: Client, filter: ListFilter): Promise<Observation[]> {
  if (noProjects(filter.project)) return [];
  const params: unknown[] = [];
  const conditions = scopeConditions(filter, params);
  if (filter.after !== undefined) {
    if (filter.afterId === undefined) {
      conditions.push('created_at > ?');
      params.push(filter.after);
    } else {
      conditions.push('(created_at > ? OR (created_at = ? AND id > ?))');
      params.push(filter.after, filter.after, filter.afterId);
    }
  }
  if (filter.vectorStale) {
    const stale = ['embedding IS NULL', 'embedder IS NULL'];
    if (filter.vectorStale.embedder !== undefined) {
      stale.push('embedder != ?');
      params.push(filter.vectorStale.embedder);
    }
    conditions.push(`(${stale.join(' OR ')})`);
  }
  params.push(filter.limit ?? 1000);

  const direction = filter.newest ? 'DESC' : 'ASC';
  const res = await client.execute({
    sql: `SELECT ${listColumns(filter)} FROM observations ${where(conditions)}
          ORDER BY created_at ${direction}, id ${direction} LIMIT ?`,
    args: params as Value[],
  });
  return res.rows.map(toObservation);
}

export async function count(client: Client, filter: CountFilter): Promise<number> {
  if (noProjects(filter.project)) return 0;
  const params: unknown[] = [];
  const conditions = scopeConditions(filter, params);
  const res = await client.execute({
    sql: `SELECT COUNT(*) AS n FROM observations ${where(conditions)}`,
    args: params as Value[],
  });
  return Number(res.rows[0]?.['n'] ?? 0);
}

export async function listProjects(client: Client): Promise<ProjectSummary[]> {
  const res = await client.execute({
    sql: `SELECT project, COUNT(*) AS n, MAX(created_at) AS last
          FROM observations GROUP BY project ORDER BY last DESC`,
    args: [],
  });
  return res.rows.map((row) => ({
    project: row['project'] as string,
    observations: Number(row['n']),
    lastActive: Number(row['last']),
  }));
}

export async function inventory(client: Client): Promise<string[]> {
  const res = await client.execute({
    sql: `SELECT name FROM sqlite_master
          WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
            AND name NOT LIKE 'libsql_%' AND name NOT LIKE '_litestream%'`,
    args: [],
  });
  return foreignNames(res.rows.map((row) => (typeof row['name'] === 'string' ? row['name'] : '')));
}

async function setStatus(client: Client, ids: string[], sql: string): Promise<number> {
  if (ids.length === 0) return 0;
  const res = await client.execute({ sql, args: [JSON.stringify(ids)] });
  return changedCount(res.rowsAffected);
}

export async function closeObservations(client: Client, ids: string[]): Promise<number> {
  return setStatus(
    client,
    ids,
    `UPDATE observations SET status = 'done'
     WHERE status = 'open' AND id IN (SELECT value FROM json_each(?))`,
  );
}

export async function markReplaced(client: Client, ids: string[]): Promise<number> {
  return setStatus(
    client,
    ids,
    `UPDATE observations SET status = 'replaced'
     WHERE status != 'replaced' AND id IN (SELECT value FROM json_each(?))`,
  );
}
