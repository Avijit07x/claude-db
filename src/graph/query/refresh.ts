import type { MemoryStore } from '../../store/adapter.js';
import { currentHashes, saveScan, scanRepository } from '../scan/index.js';
import { staleFiles } from './stale.js';

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
  const scanned = await store.scannedFiles(project);
  if (scanned.length > 0 && staleFiles(root, scanned).length === 0) return [];
  const stored = new Map(scanned.map((file) => [file.path, file.hash]));
  const hashes = changesOnDisk(root, stored);
  if (!hashes) return [];

  const scan = await scanRepository({ root, project, stored, hashes, saveCacheLater: true });
  await saveScan(store, project, scan);
  return [...scan.removed, ...scan.changed];
}
