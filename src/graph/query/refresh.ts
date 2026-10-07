import type { MemoryStore } from '../../store/adapter.js';
import { currentHashes, saveScan, scanRepository } from '../scan/index.js';

function changesOnDisk(
  root: string,
  stored: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> | null {
  const current = currentHashes(root);
  for (const [path, hash] of current) if (stored.get(path) !== hash) return current;
  for (const path of stored.keys()) if (!current.has(path)) return current;
  return null;
}

export async function refreshGraph(
  store: MemoryStore,
  root: string,
  project: string,
): Promise<string[]> {
  const stored = new Map((await store.scannedFiles(project)).map((file) => [file.path, file.hash]));
  const hashes = changesOnDisk(root, stored);
  if (!hashes) return [];

  const scan = await scanRepository({ root, project, stored, hashes, saveCacheLater: true });
  await saveScan(store, project, scan);
  return [...scan.removed, ...scan.changed];
}
