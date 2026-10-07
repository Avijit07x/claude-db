import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR } from '../../config/dir.js';
import type { CodeSymbol } from '../../types.js';
import { scopeToken } from '../../util/scope.js';
import type { Receiver, Reference } from '../types.js';
import { CACHE_KEY } from './files.js';

const MEMO_IDLE_MS = 10 * 60 * 1000;

export interface CachedFile {
  hash: string;
  symbols: CodeSymbol[];
  references: Reference[];
  edgesHash: string;
}

interface StoredReference extends Omit<Reference, 'file' | 'from' | 'to' | 'receiver' | 'returns'> {
  from: number | CodeSymbol | null;
  to?: number | string;
  receiver?: number;
  returns?: number;
}

interface StoredFile extends Omit<CachedFile, 'references'> {
  references: StoredReference[];
  receivers?: Receiver[];
}

interface ReceiverTable {
  list: Receiver[];
  indexOf: (receiver: Receiver) => number;
}

interface StoredCache {
  key: string;
  project: string;
  files: Record<string, StoredFile>;
}

export const cacheHome = (): string =>
  process.env['CLAUDE_DB_GRAPH_CACHE'] ?? join(CONFIG_DIR, 'graph-cache');

const cachePath = (project: string): string => join(cacheHome(), `${scopeToken(project)}.json`);

function receiverTable(): ReceiverTable {
  const list: Receiver[] = [];
  const positions = new Map<Receiver, number>();
  const indexOf = (receiver: Receiver): number => {
    const known = positions.get(receiver);
    if (known !== undefined) return known;
    positions.set(receiver, list.length);
    list.push(receiver);
    return list.length - 1;
  };
  return { list, indexOf };
}

function storeReference(
  reference: Reference,
  index: ReadonlyMap<string, number>,
  receivers: ReceiverTable,
): StoredReference {
  const { file: _file, from, to, receiver, returns, ...rest } = reference;
  const fromAt = from ? index.get(from.id) : undefined;
  const toAt = to === undefined ? undefined : index.get(to);
  const stored: StoredReference = { ...rest, from: fromAt ?? from };
  if (to !== undefined) stored.to = toAt ?? to;
  if (receiver) stored.receiver = receivers.indexOf(receiver);
  if (returns) stored.returns = receivers.indexOf(returns);
  return stored;
}

function loadReference(
  path: string,
  stored: StoredReference,
  symbols: CodeSymbol[],
  receivers: Receiver[],
): Reference {
  const from = typeof stored.from === 'number' ? (symbols[stored.from] ?? null) : stored.from;
  const to = typeof stored.to === 'number' ? symbols[stored.to]?.id : stored.to;
  const receiver = stored.receiver === undefined ? undefined : receivers[stored.receiver];
  const returns = stored.returns === undefined ? undefined : receivers[stored.returns];
  const loaded = Object.assign(stored, { file: path, from });
  delete loaded.to;
  delete loaded.receiver;
  delete loaded.returns;
  const reference = loaded as unknown as Reference;
  if (to !== undefined) reference.to = to;
  if (receiver) reference.receiver = receiver;
  if (returns) reference.returns = returns;
  return reference;
}

function toStored(entry: CachedFile): StoredFile {
  const index = new Map(entry.symbols.map((symbol, at) => [symbol.id, at]));
  const receivers = receiverTable();
  const references = entry.references.map((ref) => storeReference(ref, index, receivers));
  return {
    ...entry,
    references,
    ...(receivers.list.length > 0 ? { receivers: receivers.list } : {}),
  };
}

function fromStored(path: string, entry: StoredFile): CachedFile {
  const { receivers = [], ...rest } = entry;
  return {
    ...rest,
    references: entry.references.map((ref) => loadReference(path, ref, entry.symbols, receivers)),
  };
}

const isStoredCache = (value: unknown): value is StoredCache =>
  typeof value === 'object' && value !== null && 'files' in value && 'key' in value;

function readStored(project: string): StoredCache | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(cachePath(project), 'utf8'));
    if (!isStoredCache(parsed) || parsed.key !== CACHE_KEY || parsed.project !== project) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

interface Memo {
  project: string;
  stamp: string;
  files: ReadonlyMap<string, CachedFile>;
}

let memo: Memo | null = null;
let forget: NodeJS.Timeout | undefined;

function fileStamp(path: string): string {
  try {
    const stat = statSync(path);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return '';
  }
}

function remember(project: string, files: ReadonlyMap<string, CachedFile>): void {
  memo = { project, stamp: fileStamp(cachePath(project)), files };
  clearTimeout(forget);
  forget = setTimeout(() => {
    memo = null;
  }, MEMO_IDLE_MS);
  forget.unref();
}

function readCache(project: string): Map<string, CachedFile> {
  const stored = readStored(project);
  if (!stored) return new Map();
  try {
    return new Map(
      Object.entries(stored.files).map(([path, entry]) => [path, fromStored(path, entry)]),
    );
  } catch {
    return new Map();
  }
}

export function loadCache(project: string): ReadonlyMap<string, CachedFile> {
  const stamp = fileStamp(cachePath(project));
  if (memo?.project === project && memo.stamp === stamp && stamp !== '') {
    remember(project, memo.files);
    return memo.files;
  }
  const files = readCache(project);
  remember(project, files);
  return files;
}

export function saveCache(project: string, files: ReadonlyMap<string, CachedFile>): void {
  const target = cachePath(project);
  const temporary = `${target}.${process.pid}.tmp`;
  const stored: StoredCache = {
    key: CACHE_KEY,
    project,
    files: Object.fromEntries([...files].map(([path, entry]) => [path, toStored(entry)])),
  };
  try {
    mkdirSync(cacheHome(), { recursive: true });
    writeFileSync(temporary, JSON.stringify(stored));
    renameSync(temporary, target);
    remember(project, files);
  } catch {
    rmSync(temporary, { force: true });
  }
}
