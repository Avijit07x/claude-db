import type { DatabaseSync } from 'node:sqlite';
import type { ProjectFilter, Session } from '../../types.js';
import { projectClause } from './filters.js';
import type { Row } from './rows.js';
import { toSession } from './rows.js';
import { summaryTime } from '../session-time.js';
import { noProjects } from '../project-scope.js';

export async function upsertSession(db: DatabaseSync, session: Session): Promise<void> {
  db.prepare(
    `INSERT INTO sessions (id, project, started_at, ended_at, summary, updated_at, distilled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           project      = excluded.project,
           ended_at     = COALESCE(excluded.ended_at,     sessions.ended_at),
           summary      = COALESCE(excluded.summary,      sessions.summary),
           updated_at   = COALESCE(excluded.updated_at,   sessions.updated_at),
           distilled_at = COALESCE(excluded.distilled_at, sessions.distilled_at)`,
  ).run(
    session.id,
    session.project,
    session.startedAt,
    session.endedAt ?? null,
    session.summary ?? null,
    summaryTime(session),
    session.distilledAt ?? null,
  );
}

export async function clearSummary(db: DatabaseSync, id: string): Promise<boolean> {
  const result = db
    .prepare(
      'UPDATE sessions SET summary = NULL, updated_at = ? WHERE id = ? AND summary IS NOT NULL',
    )
    .run(Date.now(), id);
  return Number(result.changes) > 0;
}

export async function getSession(db: DatabaseSync, id: string): Promise<Session | null> {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Row | undefined;
  return row ? toSession(row) : null;
}

export async function recentSessions(
  db: DatabaseSync,
  project: ProjectFilter,
  limit: number,
): Promise<Session[]> {
  if (noProjects(project)) return [];
  const params: unknown[] = [];
  const scope = projectClause('project', project, params) ?? '1 = 1';
  const rows = db
    .prepare(
      `SELECT * FROM sessions
         WHERE ${scope} AND summary IS NOT NULL
         ORDER BY started_at DESC LIMIT ?`,
    )
    .all(...(params as never[]), limit) as Row[];
  return rows.map(toSession);
}

export async function sessionProjects(db: DatabaseSync): Promise<string[]> {
  const rows = db.prepare('SELECT DISTINCT project FROM sessions').all() as Row[];
  return rows
    .map((row) => (typeof row['project'] === 'string' ? row['project'] : ''))
    .filter((project) => project.length > 0);
}
