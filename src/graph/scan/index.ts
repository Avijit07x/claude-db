import { createHash } from 'node:crypto';
import type { CodeEdge, CodeSymbol, ScannedFile } from '../../types.js';
import { GRAMMARS } from '../grammars.js';
import { languageFor } from '../languages/index.js';
import type { LanguageSpec } from '../languages/rules.js';
import { createModuleContext } from '../modules/registry.js';
import { loadParser } from '../parser.js';
import type { SourceFile } from '../types.js';
import type { CachedFile } from './cache.js';
import { loadCache, saveCache } from './cache.js';
import type { Reference } from './extract.js';
import { extractFile } from './extract.js';
import { listFiles, readSource } from './files.js';
import type { Linker } from './resolve.js';
import { createLinker } from './resolve.js';

export { SCAN_VERSION, currentHashes, hashOf } from './files.js';
export { saveScan } from './persist.js';

export interface ScanOptions {
  root: string;
  project: string;
  stored?: ReadonlyMap<string, string>;
  force?: boolean;
  hashes?: ReadonlyMap<string, string>;
  saveCacheLater?: boolean;
}

export interface ScanResult {
  symbols: CodeSymbol[];
  edges: CodeEdge[];
  files: ScannedFile[];
  changed: string[];
  rewrite: string[];
  removed: string[];
  skipped: number;
  unsupported: number;
  patternRead: Record<string, number>;
}

interface Collected {
  paths: string[];
  entries: Map<string, CachedFile>;
  changed: string[];
  skipped: number;
  unsupported: number;
  patternRead: Record<string, number>;
}

const nextTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function extractEntry(file: SourceFile, project: string): CachedFile | null {
  if (file.unreadable) return { hash: file.hash, symbols: [], references: [], edgesHash: '' };
  try {
    const { symbols, references } = extractFile(file, project);
    return { hash: file.hash, symbols, references, edgesHash: '' };
  } catch {
    return null;
  }
}

function countPatternRead(counts: Record<string, number>, spec: LanguageSpec): void {
  if (spec.basic && GRAMMARS.includes(spec.label)) {
    counts[spec.label] = (counts[spec.label] ?? 0) + 1;
  }
}

async function collect(
  root: string,
  project: string,
  cache: ReadonlyMap<string, CachedFile>,
  hashes?: ReadonlyMap<string, string>,
): Promise<Collected> {
  const paths = listFiles(root);
  const state: Collected = {
    paths,
    entries: new Map(),
    changed: [],
    skipped: 0,
    unsupported: 0,
    patternRead: {},
  };
  for (const path of paths) {
    const spec = languageFor(path);
    if (!spec) {
      state.unsupported += 1;
      continue;
    }
    countPatternRead(state.patternRead, spec);
    const cached = cache.get(path);
    if (cached && hashes?.get(path) === cached.hash) {
      state.entries.set(path, cached);
      state.skipped += 1;
      continue;
    }
    const file = readSource(root, path);
    if (!file) {
      state.unsupported += 1;
      continue;
    }
    if (cached?.hash === file.hash) {
      state.entries.set(path, cached);
      state.skipped += 1;
      continue;
    }
    const entry = extractEntry(file, project);
    if (file.unreadable || !entry) state.unsupported += 1;
    if (!entry) continue;
    state.entries.set(path, entry);
    state.changed.push(path);
    await nextTurn();
  }
  return state;
}

function linkerFor(root: string, project: string, state: Collected): Linker {
  const entries = [...state.entries.values()];
  return createLinker(
    project,
    entries.flatMap((entry) => entry.symbols),
    entries.flatMap((entry) => entry.references),
    createModuleContext(root, new Set(state.paths)),
  );
}

const fingerprint = (linker: Linker, references: Reference[]): string =>
  createHash('sha1')
    .update(references.map((reference) => linker.outcome(reference)).join('\n'))
    .digest('base64url');

export async function scanRepository(options: ScanOptions): Promise<ScanResult> {
  const { root, project, force = false } = options;
  const stored = options.stored ?? new Map<string, string>();
  loadParser();

  const scannedAt = Date.now();
  const cache: ReadonlyMap<string, CachedFile> = force ? new Map() : loadCache(project);
  const state = await collect(root, project, cache, options.hashes);
  const linker = linkerFor(root, project, state);
  const changed = new Set(state.changed);
  const rewrite: string[] = [];
  const files: ScannedFile[] = [];

  for (const [path, entry] of state.entries) {
    const edgesHash = fingerprint(linker, entry.references);
    const dirty = force || changed.has(path) || stored.get(path) !== entry.hash;
    if (dirty || edgesHash !== entry.edgesHash) rewrite.push(path);
    state.entries.set(path, { ...entry, edgesHash });
    files.push({ project, path, hash: entry.hash, scannedAt });
  }
  if (options.saveCacheLater) setImmediate(() => saveCache(project, state.entries));
  else saveCache(project, state.entries);

  return {
    symbols: [...state.entries.values()].flatMap((entry) => entry.symbols),
    edges: rewrite.flatMap((path) => linker.edgesFor(state.entries.get(path)?.references ?? [])),
    files,
    changed: state.changed,
    rewrite,
    removed: [...stored.keys()].filter((path) => !state.entries.has(path)),
    skipped: state.skipped,
    unsupported: state.unsupported,
    patternRead: state.patternRead,
  };
}
