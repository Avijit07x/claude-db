import type { Collection } from './driver.js';
import type { ProjectLinkDoc } from './docs.js';
import { isLinkable, orderScope } from '../project-scope.js';

const ID_SEPARATOR = '\u0000';

export async function linkProject(
  links: Collection<ProjectLinkDoc>,
  folder: string,
  key: string,
  now: number,
): Promise<void> {
  if (!isLinkable(folder, key)) return;
  await links.updateOne(
    { _id: `${folder}${ID_SEPARATOR}${key}` },
    { $setOnInsert: { folder, projectKey: key, firstSeen: now } },
    { upsert: true },
  );
}

export async function projectScope(
  links: Collection<ProjectLinkDoc>,
  folder: string,
): Promise<string[]> {
  const own = await links.find({ folder }).toArray();
  const keys = own.map((doc) => doc.projectKey);
  const shared = keys.length > 0 ? await links.find({ projectKey: { $in: keys } }).toArray() : [];
  return orderScope(folder, [...keys, ...shared.map((doc) => doc.folder)]);
}
