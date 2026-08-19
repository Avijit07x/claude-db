import type { MemoryStore } from '../../store/adapter.js';
import { currentHashes, scanRepository } from '../scan/index.js';

export async function refreshGraph(
  store: MemoryStore,
  root: string,
  project: string,
): Promise<string[]> {
  const stored = new Map((await store.scannedFiles(project)).map((file) => [file.path, file.hash]));
  const current = currentHashes(root);

  const changed = [...current.entries()]
    .filter(([path, hash]) => stored.get(path) !== hash)
    .map(([path]) => path);
  const deleted = [...stored.keys()].filter((path) => !current.has(path));

  if (deleted.length > 0) await store.removeGraph(project, deleted);
  if (changed.length === 0) return deleted;

  const scan = scanRepository({ root, project, known: new Map() });
  await store.removeGraph(project, scan.changed);
  await store.upsertGraph({
    symbols: scan.symbols,
    edges: scan.edges,
    files: scan.files,
  });
  return [...deleted, ...changed];
}
