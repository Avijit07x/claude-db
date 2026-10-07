import { closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScannedFile } from '../../types.js';
import { hashOf, sourceFiles } from '../scan/files.js';

const MTIME_SLACK_MS = 2000;

function changedSinceScan(root: string, entry: ScannedFile): boolean {
  let fd: number;
  try {
    fd = openSync(join(root, entry.path), 'r');
  } catch {
    return true;
  }
  try {
    if (fstatSync(fd).mtimeMs <= entry.scannedAt - MTIME_SLACK_MS) return false;
    return hashOf(readFileSync(fd)) !== entry.hash;
  } catch {
    return true;
  } finally {
    closeSync(fd);
  }
}

export function staleFiles(root: string, stored: ScannedFile[]): string[] {
  const known = new Map(stored.map((entry) => [entry.path, entry]));
  const current = sourceFiles(root);
  const stale: string[] = [];
  for (const path of current) {
    const entry = known.get(path);
    if (!entry || changedSinceScan(root, entry)) stale.push(path);
  }
  const present = new Set(current);
  for (const path of known.keys()) if (!present.has(path)) stale.push(path);
  return stale;
}
