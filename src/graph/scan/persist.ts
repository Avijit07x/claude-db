import type { MemoryStore } from '../../store/adapter.js';
import type { ScanResult } from './index.js';

const REMOVE_BATCH = 500;

async function removeFiles(store: MemoryStore, project: string, files: string[]): Promise<void> {
  for (let start = 0; start < files.length; start += REMOVE_BATCH) {
    const batch = files.slice(start, start + REMOVE_BATCH);
    if (batch.length > 0) await store.removeGraph(project, batch);
  }
}

export async function saveScan(
  store: MemoryStore,
  project: string,
  scan: ScanResult,
  force = false,
): Promise<void> {
  if (force) {
    await store.removeGraph(project);
    await store.upsertGraph({ symbols: scan.symbols, edges: scan.edges, files: scan.files });
    return;
  }
  await removeFiles(store, project, [...scan.removed, ...scan.rewrite]);
  const rewrite = new Set(scan.rewrite);
  await store.upsertGraph({
    symbols: scan.symbols.filter((symbol) => rewrite.has(symbol.file)),
    edges: scan.edges.filter((edge) => rewrite.has(edge.file)),
    files: scan.files.filter((file) => rewrite.has(file.path)),
  });
}
