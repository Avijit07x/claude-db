import type { DatabaseSync } from 'node:sqlite';
import type {
  ObservationIndexEntry,
  ObservationKind,
  SearchQuery,
  TimelineQuery,
} from '../../types.js';
import type { Row } from './rows.js';
import { toBuffer, toIndexEntry } from './rows.js';
import { TAG_PREDICATE, appendScope, toMatchExpression } from './filters.js';
import { cosine, unpackVector } from '../../util/vector.js';

export async function searchKeyword(
  db: DatabaseSync,
  query: SearchQuery,
): Promise<ObservationIndexEntry[]> {
  const match = toMatchExpression(query.text, query.project);
  if (match === null) return [];

  const conditions = ['observations_fts MATCH ?'];
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
  params.push(query.limit);

  const rows = db
    .prepare(
      `SELECT o.id, o.kind, o.title, o.project, o.created_at,
                snippet(observations_fts, 1, '', '', '…', 14) AS snippet,
                -bm25(observations_fts, 10.0, 1.0, 5.0, 0.0) AS score
         FROM observations_fts
         JOIN observations o ON o.rowid = observations_fts.rowid
         WHERE ${conditions.join(' AND ')}
         ORDER BY score DESC
         LIMIT ?`,
    )
    .all(...(params as never[])) as Row[];

  return rows.map(toIndexEntry);
}

export async function searchVector(
  db: DatabaseSync,
  vector: number[],
  query: SearchQuery,
): Promise<ObservationIndexEntry[]> {
  const conditions = ['embedding IS NOT NULL'];
  const params: unknown[] = [];
  appendScope(query, conditions, params, '');

  if (query.embedder) {
    conditions.push('(embedder = ? OR embedder IS NULL)');
    params.push(query.embedder);
  }

  params.push(query.maxScanCandidates ?? 25000);

  const rows = db
    .prepare(
      `SELECT id, kind, title, project, created_at, embedding
         FROM observations WHERE ${conditions.join(' AND ')}
         ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...(params as never[])) as Row[];

  return rows
    .map((row) => ({
      id: row['id'] as string,
      kind: row['kind'] as ObservationKind,
      title: row['title'] as string,
      project: row['project'] as string,
      createdAt: Number(row['created_at']),
      score: row['embedding'] ? cosine(vector, unpackVector(toBuffer(row['embedding']))) : 0,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, query.limit);
}

export async function timeline(
  db: DatabaseSync,
  query: TimelineQuery,
): Promise<ObservationIndexEntry[]> {
  const anchor = db
    .prepare('SELECT project, created_at FROM observations WHERE id = ?')
    .get(query.observationId) as Row | undefined;
  if (!anchor) return [];

  const rows = db
    .prepare(
      `SELECT id, kind, title, project, created_at, 0 AS score FROM (
           SELECT * FROM observations
           WHERE project = ? AND created_at <= ?
           ORDER BY created_at DESC LIMIT ?
         )
         UNION
         SELECT id, kind, title, project, created_at, 0 AS score FROM (
           SELECT * FROM observations
           WHERE project = ? AND created_at > ?
           ORDER BY created_at ASC LIMIT ?
         )
         ORDER BY created_at ASC`,
    )
    .all(
      anchor['project'] as string,
      anchor['created_at'] as number,
      query.before + 1,
      anchor['project'] as string,
      anchor['created_at'] as number,
      query.after,
    ) as Row[];

  return rows.map(toIndexEntry);
}
