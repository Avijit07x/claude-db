import type { Client, Value } from './driver.js';
import type { ProjectFilter, Session } from '../../types.js';
import { projectClause } from '../sqlite/filters.js';
import { toSession } from '../sqlite/rows.js';
import { changedCount } from './rows.js';
import { summaryTime } from '../session-time.js';
import { noProjects } from '../project-scope.js';

export async function upsertSession(client: Client, session: Session): Promise<void> {
  await client.execute({
    sql: `INSERT INTO sessions (id, project, started_at, ended_at, summary, updated_at, distilled_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            project      = excluded.project,
            ended_at     = COALESCE(excluded.ended_at,     sessions.ended_at),
            summary      = COALESCE(excluded.summary,      sessions.summary),
            updated_at   = COALESCE(excluded.updated_at,   sessions.updated_at),
            distilled_at = COALESCE(excluded.distilled_at, sessions.distilled_at)`,
    args: [
      session.id,
      session.project,
      session.startedAt,
      session.endedAt ?? null,
      session.summary ?? null,
      summaryTime(session) ?? null,
      session.distilledAt ?? null,
    ],
  });
}

export async function clearSummary(client: Client, id: string): Promise<boolean> {
  const res = await client.execute({
    sql: 'UPDATE sessions SET summary = NULL, updated_at = ? WHERE id = ? AND summary IS NOT NULL',
    args: [Date.now(), id],
  });
  return changedCount(res.rowsAffected) > 0;
}

export async function getSession(client: Client, id: string): Promise<Session | null> {
  const res = await client.execute({ sql: 'SELECT * FROM sessions WHERE id = ?', args: [id] });
  const row = res.rows[0];
  return row ? toSession(row) : null;
}

export async function recentSessions(
  client: Client,
  project: ProjectFilter,
  limit: number,
): Promise<Session[]> {
  if (noProjects(project)) return [];
  const params: unknown[] = [];
  const scope = projectClause('project', project, params) ?? '1 = 1';
  const res = await client.execute({
    sql: `SELECT * FROM sessions
          WHERE ${scope} AND summary IS NOT NULL
          ORDER BY started_at DESC LIMIT ?`,
    args: [...(params as Value[]), limit],
  });
  return res.rows.map(toSession);
}

export async function sessionProjects(client: Client): Promise<string[]> {
  const res = await client.execute({ sql: 'SELECT DISTINCT project FROM sessions', args: [] });
  return res.rows
    .map((row) => (typeof row['project'] === 'string' ? row['project'] : ''))
    .filter((project) => project.length > 0);
}
