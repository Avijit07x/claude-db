import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MemoryStore } from '../../store/adapter.js';
import type { ScannedFile } from '../../types.js';
import { currentHashes, hashOf, saveScan, scanRepository } from '../scan/index.js';
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

function scannedByOtherScanner(root: string, scanned: ScannedFile[]): boolean {
  for (const entry of scanned) {
    try {
      return hashOf(readFileSync(join(root, entry.path))) !== entry.hash;
    } catch {
      continue;
    }
  }
  return false;
}

export async function refreshGraph(
  store: MemoryStore,
  root: string,
  project: string,
): Promise<string[]> {
  const scanned = await store.scannedFiles(project);
  const upToDate = staleFiles(root, scanned).length === 0 && !scannedByOtherScanner(root, scanned);
  if (scanned.length > 0 && upToDate) return [];
  const stored = new Map(scanned.map((file) => [file.path, file.hash]));
  const hashes = changesOnDisk(root, stored);
  if (!hashes) return [];

  const scan = await scanRepository({ root, project, stored, hashes, saveCacheLater: true });
  await saveScan(store, project, scan);
  return [...scan.removed, ...scan.changed];
}
