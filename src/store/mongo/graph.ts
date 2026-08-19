import type { Collection, Doc } from './driver.js';
import type { CodeEdge, CodeSymbol, EdgeFilter, ScannedFile, SymbolFilter } from '../../types.js';
import type { EdgeDoc, ScannedFileDoc, SymbolDoc } from './docs.js';
import { toEdge, toSymbol, upsertsOf } from './docs.js';

export async function upsertGraph(
  symbols: Collection<SymbolDoc>,
  edges: Collection<EdgeDoc>,
  scanned: Collection<ScannedFileDoc>,
  scan: {
    symbols: CodeSymbol[];
    edges: CodeEdge[];
    files: ScannedFile[];
  },
): Promise<void> {
  if (scan.symbols.length > 0) {
    await symbols.bulkWrite(
      upsertsOf(scan.symbols, (s) => s.id),
      { ordered: false },
    );
  }
  if (scan.edges.length > 0) {
    await edges.bulkWrite(
      upsertsOf(scan.edges, (e) => e.id),
      { ordered: false },
    );
  }
  if (scan.files.length > 0) {
    await scanned.bulkWrite(
      upsertsOf(scan.files, (f) => `${f.project} ${f.path}`),
      { ordered: false },
    );
  }
}

export async function findSymbols(
  symbols: Collection<SymbolDoc>,
  edges: Collection<EdgeDoc>,
  scanned: Collection<ScannedFileDoc>,
  filter: SymbolFilter,
): Promise<CodeSymbol[]> {
  const query: Record<string, unknown> = { project: filter.project };
  if (filter.name) query['name'] = filter.name;
  if (filter.file) query['file'] = filter.file;

  const docs = await symbols
    .find(query as Doc)
    .sort({ file: 1, line: 1 })
    .limit(filter.limit ?? 500)
    .toArray();
  return docs.map(toSymbol);
}

export async function findEdges(
  symbols: Collection<SymbolDoc>,
  edges: Collection<EdgeDoc>,
  scanned: Collection<ScannedFileDoc>,
  filter: EdgeFilter,
): Promise<CodeEdge[]> {
  const query: Record<string, unknown> = { project: filter.project };
  const alternatives: Record<string, unknown>[] = [];
  if (filter.srcIds && filter.srcIds.length > 0) {
    alternatives.push({ srcId: { $in: filter.srcIds } });
  }
  if (filter.dstIds && filter.dstIds.length > 0) {
    alternatives.push({ dstId: { $in: filter.dstIds } });
  }
  if (alternatives.length > 0) query['$or'] = alternatives;

  const docs = await edges
    .find(query as Doc)
    .limit(filter.limit ?? 2000)
    .toArray();
  return docs.map(toEdge);
}

export async function scannedFiles(
  symbols: Collection<SymbolDoc>,
  edges: Collection<EdgeDoc>,
  scanned: Collection<ScannedFileDoc>,
  project: string,
): Promise<ScannedFile[]> {
  const docs = await scanned.find({ project } as Doc).toArray();
  return docs.map((doc) => ({
    project: doc.project,
    path: doc.path,
    hash: doc.hash,
    scannedAt: doc.scannedAt,
  }));
}

export async function removeGraph(
  symbols: Collection<SymbolDoc>,
  edges: Collection<EdgeDoc>,
  scanned: Collection<ScannedFileDoc>,
  project: string,
  files?: string[],
): Promise<number> {
  const scoped = files !== undefined && files.length > 0;
  const symbolQuery = scoped ? { project, file: { $in: files } } : { project };
  const cacheQuery = scoped ? { project, path: { $in: files } } : { project };

  const count = await symbols.countDocuments(symbolQuery as Doc);
  await symbols.deleteMany(symbolQuery as Doc);
  await edges.deleteMany(symbolQuery as Doc);
  await scanned.deleteMany(cacheQuery as Doc);
  return count;
}
