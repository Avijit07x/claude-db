import type { Pool } from './driver.js';
import type { ObservationIndexEntry, SearchQuery } from '../../types.js';
import { appendScope } from './filters.js';
import { toIndexEntry } from './rows.js';

export async function searchVector(
  pool: Pool,
  vectorEnabled: boolean,
  vectorDims: number | null,
  vector: number[],
  query: SearchQuery,
): Promise<ObservationIndexEntry[]> {
  if (!vectorEnabled || vectorDims !== vector.length) return [];

  const conditions = ['embedding IS NOT NULL'];
  const values: unknown[] = [`[${vector.join(',')}]`];
  appendScope(query, conditions, values);

  if (query.embedder) {
    values.push(query.embedder);
    conditions.push(`(embedder = $${values.length} OR embedder IS NULL)`);
  }
  values.push(query.limit);

  const res = await pool.query(
    `SELECT id, kind, title, project, created_at,
              1 - (embedding <=> $1::vector) AS score
       FROM observations
       WHERE ${conditions.join(' AND ')}
       ORDER BY embedding <=> $1::vector
       LIMIT $${values.length}`,
    values,
  );
  return res.rows.map(toIndexEntry);
}
