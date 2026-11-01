import type { MemoryStore } from '../../store/adapter.js';
import type { ScanResult } from './index.js';

export async function saveScan(
  store: MemoryStore,
  project: string,
  scan: ScanResult,
  force = false,
): Promise<void> {
  if (force) {
    await store.replaceGraph(project, null, {
      symbols: scan.symbols,
      edges: scan.edges,
      files: scan.files,
    });
    return;
  }
  const rewrite = new Set(scan.rewrite);
  const symbols = scan.symbols.filter((symbol) => rewrite.has(symbol.file));
  const edges = scan.edges.filter((edge) => rewrite.has(edge.file));
  const files = scan.files.filter((file) => rewrite.has(file.path));
  const replaced = [...scan.removed, ...scan.rewrite];
  if (replaced.length === 0 && symbols.length + edges.length + files.length === 0) return;
  await store.replaceGraph(project, replaced, { symbols, edges, files });
}
