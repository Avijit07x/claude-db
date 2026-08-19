import type { Pool } from './driver.js';
import type { Observation } from '../../types.js';

export async function insertObservations(
  pool: Pool,
  ensureVectorColumn: (dims: number) => Promise<boolean>,
  observations: Observation[],
): Promise<void> {
  if (observations.length === 0) return;

  const width = observations.find((obs) => obs.embedding?.length)?.embedding?.length;
  const vectors = width !== undefined && (await ensureVectorColumn(width));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const obs of observations) {
      const columns = [
        'id',
        'session_id',
        'project',
        'kind',
        'title',
        'body',
        'files',
        'tags',
        'created_at',
        'embedder',
        'author',
        'status',
      ];
      const values: unknown[] = [
        obs.id,
        obs.sessionId,
        obs.project,
        obs.kind,
        obs.title,
        obs.body,
        JSON.stringify(obs.files),
        JSON.stringify(obs.tags),
        obs.createdAt,
        obs.embedder ?? null,
        obs.author ?? null,
        obs.status ?? 'done',
      ];
      if (vectors && obs.embedding?.length === width) {
        columns.push('embedding');
        values.push(`[${obs.embedding.join(',')}]`);
      }
      const holes = values.map((_, i) => `$${i + 1}`).join(', ');
      const updates = columns
        .slice(1)
        .map((column) => `${column} = EXCLUDED.${column}`)
        .join(', ');
      await client.query(
        `INSERT INTO observations (${columns.join(', ')}) VALUES (${holes})
           ON CONFLICT (id) DO UPDATE SET ${updates}`,
        values,
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
