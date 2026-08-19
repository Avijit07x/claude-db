import type { Pool } from './driver.js';
import type { ObservationIndexEntry, SearchQuery } from '../../types.js';
import { appendScope } from './filters.js';
import { toIndexEntry } from './rows.js';

export async function searchKeyword(
  pool: Pool,
  query: SearchQuery,
): Promise<ObservationIndexEntry[]> {
  const conditions = ['tsv @@ q.tsq'];
  const values: unknown[] = [query.text];
  appendScope(query, conditions, values);
  values.push(query.limit);

  const res = await pool.query(
    `WITH q AS (
         SELECT replace(plainto_tsquery('english', $1)::text, '&', '|')::tsquery AS tsq
       )
       SELECT id, kind, title, project, created_at,
              ts_headline('english', body, q.tsq,
                          'MaxFragments=1, MaxWords=18, MinWords=5') AS snippet,
              ts_rank(tsv, q.tsq) AS score
       FROM observations, q
       WHERE ${conditions.join(' AND ')}
       ORDER BY score DESC
       LIMIT $${values.length}`,
    values,
  );
  return res.rows.map(toIndexEntry);
}
