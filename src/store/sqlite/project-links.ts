import type { DatabaseSync } from 'node:sqlite';
import { isLinkable, orderScope } from '../project-scope.js';
import type { Row } from './rows.js';

export async function linkProject(
  db: DatabaseSync,
  folder: string,
  key: string,
  now: number,
): Promise<void> {
  if (!isLinkable(folder, key)) return;
  db.prepare(
    'INSERT OR IGNORE INTO project_links (folder, project_key, first_seen) VALUES (?, ?, ?)',
  ).run(folder, key, now);
}

export async function projectScope(db: DatabaseSync, folder: string): Promise<string[]> {
  const rows = db
    .prepare(
      `SELECT project_key AS value FROM project_links WHERE folder = ?
       UNION
       SELECT folder AS value FROM project_links
        WHERE project_key IN (SELECT project_key FROM project_links WHERE folder = ?)`,
    )
    .all(folder, folder) as Row[];
  return orderScope(
    folder,
    rows.map((row) => String(row['value'])),
  );
}
