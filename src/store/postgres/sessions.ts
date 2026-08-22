import type { Pool } from './driver.js';
import type { Session } from '../../types.js';
import { toSession } from './rows.js';

export async function upsertSession(pool: Pool, session: Session): Promise<void> {
  await pool.query(
    `INSERT INTO sessions (id, project, started_at, ended_at, summary)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         project  = EXCLUDED.project,
         ended_at = COALESCE(EXCLUDED.ended_at, sessions.ended_at),
         summary  = COALESCE(EXCLUDED.summary,  sessions.summary)`,
    [
      session.id,
      session.project,
      session.startedAt,
      session.endedAt ?? null,
      session.summary ?? null,
    ],
  );
}

export async function getSession(pool: Pool, id: string): Promise<Session | null> {
  const res = await pool.query('SELECT * FROM sessions WHERE id = $1', [id]);
  const row = res.rows[0];
  return row ? toSession(row) : null;
}

export async function clearSummary(pool: Pool, id: string): Promise<boolean> {
  const result = await pool.query(
    'UPDATE sessions SET summary = NULL WHERE id = $1 AND summary IS NOT NULL',
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function recentSessions(
  pool: Pool,
  project: string,
  limit: number,
): Promise<Session[]> {
  const res = await pool.query(
    `SELECT * FROM sessions
       WHERE project = $1 AND summary IS NOT NULL
       ORDER BY started_at DESC LIMIT $2`,
    [project, limit],
  );
  return res.rows.map(toSession);
}
