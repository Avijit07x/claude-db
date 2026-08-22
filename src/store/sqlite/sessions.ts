import type { DatabaseSync } from 'node:sqlite';
import type { Session } from '../../types.js';
import type { Row } from './rows.js';
import { toSession } from './rows.js';

export async function upsertSession(db: DatabaseSync, session: Session): Promise<void> {
  db.prepare(
    `INSERT INTO sessions (id, project, started_at, ended_at, summary)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           project  = excluded.project,
           ended_at = COALESCE(excluded.ended_at, sessions.ended_at),
           summary  = COALESCE(excluded.summary,  sessions.summary)`,
  ).run(
    session.id,
    session.project,
    session.startedAt,
    session.endedAt ?? null,
    session.summary ?? null,
  );
}

export async function clearSummary(db: DatabaseSync, id: string): Promise<boolean> {
  const result = db
    .prepare('UPDATE sessions SET summary = NULL WHERE id = ? AND summary IS NOT NULL')
    .run(id);
  return Number(result.changes) > 0;
}

export async function getSession(db: DatabaseSync, id: string): Promise<Session | null> {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Row | undefined;
  return row ? toSession(row) : null;
}

export async function recentSessions(
  db: DatabaseSync,
  project: string,
  limit: number,
): Promise<Session[]> {
  const rows = db
    .prepare(
      `SELECT * FROM sessions
         WHERE project = ? AND summary IS NOT NULL
         ORDER BY started_at DESC LIMIT ?`,
    )
    .all(project, limit) as Row[];
  return rows.map(toSession);
}
