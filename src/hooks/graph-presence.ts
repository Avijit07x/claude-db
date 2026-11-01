import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR } from '../config/index.js';
import { cachePath } from '../graph/scan/cache.js';
import { scopeToken } from '../util/scope.js';

const ABSENT_FOR_MS = 10 * 60 * 1000;

const markerOf = (project: string): string =>
  join(CONFIG_DIR, 'graph-absent', `${scopeToken(project)}.flag`);

const modifiedAt = (file: string): number | null =>
  statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? null;

export function graphKnownAbsent(project: string, now = Date.now()): boolean {
  try {
    const marked = modifiedAt(markerOf(project));
    if (marked === null || now - marked >= ABSENT_FOR_MS) return false;
    const scanned = modifiedAt(cachePath(project));
    return scanned === null || scanned < marked;
  } catch {
    return false;
  }
}

export function graphCachedHere(project: string): boolean {
  try {
    return modifiedAt(cachePath(project)) !== null;
  } catch {
    return false;
  }
}

export function noteGraphPresence(project: string, present: boolean): void {
  const marker = markerOf(project);
  try {
    if (present) {
      rmSync(marker, { force: true });
      return;
    }
    mkdirSync(join(CONFIG_DIR, 'graph-absent'), { recursive: true });
    writeFileSync(marker, project);
  } catch {
    return;
  }
}
