import type { Client } from './driver.js';
import { isLinkable, orderScope } from '../project-scope.js';

export async function linkProject(
  client: Client,
  folder: string,
  key: string,
  now: number,
): Promise<void> {
  if (!isLinkable(folder, key)) return;
  await client.execute({
    sql: 'INSERT OR IGNORE INTO project_links (folder, project_key, first_seen) VALUES (?, ?, ?)',
    args: [folder, key, now],
  });
}

export async function projectScope(client: Client, folder: string): Promise<string[]> {
  const res = await client.execute({
    sql: `SELECT project_key AS value FROM project_links WHERE folder = ?
          UNION
          SELECT folder AS value FROM project_links
           WHERE project_key IN (SELECT project_key FROM project_links WHERE folder = ?)`,
    args: [folder, folder],
  });
  return orderScope(
    folder,
    res.rows.map((row) => String(row['value'])),
  );
}
