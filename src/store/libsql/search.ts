import type { ObservationIndexEntry, SearchQuery, TimelineQuery } from '../../types.js';
import type { Client, Value } from './driver.js';
import { toIndexEntry } from '../sqlite/rows.js';
import {
  TAG_PREDICATE,
  appendScope,
  excludeSessionsClause,
  toMatchExpression,
} from '../sqlite/filters.js';
import { packVector } from '../../util/vector.js';
import { noProjects } from '../project-scope.js';

export async function searchKeyword(
  client: Client,
  query: SearchQuery,
): Promise<ObservationIndexEntry[]> {
  if (noProjects(query.project)) return [];
  const match = toMatchExpression(query.text, query.project);
  if (match === null) return [];

  const conditions = ['observations_fts MATCH ?', "o.status != 'replaced'"];
  const params: unknown[] = [match];
  if (query.kind) {
    conditions.push('o.kind = ?');
    params.push(query.kind);
  }
  if (query.tag) {
    conditions.push(TAG_PREDICATE('o.'));
    params.push(query.tag);
  }
  if (query.since !== undefined) {
    conditions.push('o.created_at >= ?');
    params.push(query.since);
  }
  if (query.until !== undefined) {
    conditions.push('o.created_at <= ?');
    params.push(query.until);
  }
  const excluded = excludeSessionsClause('o.session_id', query.excludeSessions, params);
  if (excluded) conditions.push(excluded);
  params.push(query.limit);

  const res = await client.execute({
    sql: `SELECT o.id, o.kind, o.title, o.project, o.created_at,
                 snippet(observations_fts, 1, '', '', '…', 14) AS snippet,
                 -bm25(observations_fts, 10.0, 1.0, 5.0, 0.0) AS score
          FROM observations_fts
          JOIN observations o ON o.rowid = observations_fts.rowid
          WHERE ${conditions.join(' AND ')}
          ORDER BY score DESC
          LIMIT ?`,
    args: params as Value[],
  });
  return res.rows.map(toIndexEntry);
}

export async function searchVector(
  client: Client,
  vector: number[],
  query: SearchQuery,
): Promise<ObservationIndexEntry[]> {
  if (noProjects(query.project) || vector.length === 0) return [];
  const packed = packVector(vector);
  const conditions = ['embedding IS NOT NULL', 'length(embedding) = ?'];
  const params: unknown[] = [packed.byteLength];
  appendScope(query, conditions, params, '');
  if (query.embedder) {
    conditions.push('(embedder = ? OR embedder IS NULL)');
    params.push(query.embedder);
  }
  params.push(query.maxScanCandidates ?? 25000, query.limit);

  const res = await client.execute({
    sql: `SELECT id, kind, title, project, created_at,
                 1 - vector_distance_cos(embedding, ?) AS score
          FROM (
            SELECT id, kind, title, project, created_at, embedding
            FROM observations WHERE ${conditions.join(' AND ')}
            ORDER BY created_at DESC LIMIT ?
          )
          ORDER BY score DESC LIMIT ?`,
    args: [packed, ...(params as Value[])],
  });
  return res.rows.map(toIndexEntry);
}

export async function timeline(
  client: Client,
  query: TimelineQuery,
): Promise<ObservationIndexEntry[]> {
  const side = (op: string, order: string): string =>
    `SELECT o.id, o.kind, o.title, o.project, o.created_at
     FROM observations o, anchor a
     WHERE o.project = a.project AND o.created_at ${op} a.created_at AND o.status != 'replaced'
     ORDER BY o.created_at ${order} LIMIT ?`;
  const res = await client.execute({
    sql: `WITH anchor AS (SELECT project, created_at FROM observations WHERE id = ?)
          SELECT id, kind, title, project, created_at, 0 AS score FROM (${side('<=', 'DESC')})
          UNION
          SELECT id, kind, title, project, created_at, 0 AS score FROM (${side('>', 'ASC')})
          ORDER BY created_at ASC`,
    args: [query.observationId, query.before + 1, query.after],
  });
  return res.rows.map(toIndexEntry);
}
