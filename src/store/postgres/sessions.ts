import type { Pool } from './driver.js';
import type { ProjectFilter, Session } from '../../types.js';
import { projectClause } from './filters.js';
import { toSession } from './rows.js';
import { summaryTime } from '../session-time.js';
import { noProjects } from '../project-scope.js';

export async function upsertSession(pool: Pool, session: Session): Promise<void> {
  await pool.query(
    `INSERT INTO sessions (id, project, started_at, ended_at, summary, updated_at, distilled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         project      = EXCLUDED.project,
         ended_at     = COALESCE(EXCLUDED.ended_at,     sessions.ended_at),
         summary      = COALESCE(EXCLUDED.summary,      sessions.summary),
         updated_at   = COALESCE(EXCLUDED.updated_at,   sessions.updated_at),
         distilled_at = COALESCE(EXCLUDED.distilled_at, sessions.distilled_at)`,
    [
      session.id,
      session.project,
      session.startedAt,
      session.endedAt ?? null,
      session.summary ?? null,
      summaryTime(session),
      session.distilledAt ?? null,
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
    'UPDATE sessions SET summary = NULL, updated_at = $2 WHERE id = $1 AND summary IS NOT NULL',
    [id, Date.now()],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function recentSessions(
  pool: Pool,
  project: ProjectFilter,
  limit: number,
): Promise<Session[]> {
  if (noProjects(project)) return [];
  const values: unknown[] = [];
  const scope = projectClause(project, values) ?? 'TRUE';
  values.push(limit);
  const res = await pool.query(
    `SELECT * FROM sessions
       WHERE ${scope} AND summary IS NOT NULL
       ORDER BY started_at DESC LIMIT $${values.length}`,
    values,
  );
  return res.rows.map(toSession);
}

export async function sessionProjects(pool: Pool): Promise<string[]> {
  const res = await pool.query('SELECT DISTINCT project FROM sessions');
  return res.rows
    .map((row) => (typeof row['project'] === 'string' ? row['project'] : ''))
    .filter((p) => p.length > 0);
}
