import type { Pool } from './driver.js';
import { isLinkable, orderScope } from '../project-scope.js';

export async function linkProject(
  pool: Pool,
  folder: string,
  key: string,
  now: number,
): Promise<void> {
  if (!isLinkable(folder, key)) return;
  await pool.query(
    `INSERT INTO project_links (folder, project_key, first_seen)
       VALUES ($1, $2, $3)
       ON CONFLICT (folder, project_key) DO NOTHING`,
    [folder, key, now],
  );
}

export async function projectScope(pool: Pool, folder: string): Promise<string[]> {
  const res = await pool.query(
    `SELECT project_key AS value FROM project_links WHERE folder = $1
       UNION
       SELECT folder AS value FROM project_links
        WHERE project_key IN (SELECT project_key FROM project_links WHERE folder = $1)`,
    [folder],
  );
  return orderScope(
    folder,
    res.rows.map((row) => String(row['value'])),
  );
}
