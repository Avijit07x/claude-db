import type { CodeEdge, CodeSymbol, ScannedFile } from '../../types.js';
import { loadParser } from '../parser.js';
import { extractFile } from './extract.js';
import type { Reference } from './extract.js';
import { listFiles, readSource } from './files.js';
import { resolveEdges } from './resolve.js';

export type { SourceFile } from './files.js';
export { currentHashes, hashOf, listFiles, sourceFiles } from './files.js';

export interface ScanOptions {
  root: string;
  project: string;
  known: Map<string, string>;
  force?: boolean;
}

export interface ScanResult {
  symbols: CodeSymbol[];
  edges: CodeEdge[];
  files: ScannedFile[];
  changed: string[];
  skipped: number;
  unsupported: number;
}

export function scanRepository(options: ScanOptions): ScanResult {
  const { root, project, known, force } = options;
  loadParser();

  const result: ScanResult = {
    symbols: [],
    edges: [],
    files: [],
    changed: [],
    skipped: 0,
    unsupported: 0,
  };

  const references: Reference[] = [];
  const scannedAt = Date.now();

  for (const path of listFiles(root)) {
    const file = readSource(root, path);
    if (!file) {
      result.unsupported += 1;
      continue;
    }
    if (!force && known.get(path) === file.hash) {
      result.skipped += 1;
      continue;
    }

    let extracted;
    try {
      extracted = extractFile(file, project);
    } catch {
      result.unsupported += 1;
      continue;
    }

    result.symbols.push(...extracted.symbols);
    references.push(...extracted.references);
    result.changed.push(path);
    result.files.push({ project, path, hash: file.hash, scannedAt });
  }

  result.edges = resolveEdges(project, result.symbols, references);
  return result;
}
