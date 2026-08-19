import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { MemoryStore } from '../store/adapter.js';
import type { Observation } from '../types.js';

const MAX_BUFFER = 16 * 1024 * 1024;
const OPEN_LIMIT = 500;

function uncommittedFiles(project: string): Set<string> | null {
  try {
    const raw = execFileSync('git', ['-C', project, 'status', '--porcelain', '-z'], {
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
    });
    return new Set(
      raw
        .split('\0')
        .filter((entry) => entry.length > 3)
        .map((entry) => join(project, entry.slice(3))),
    );
  } catch {
    return null;
  }
}

export async function closeLandedWork(store: MemoryStore, project: string): Promise<number> {
  const dirty = uncommittedFiles(project);
  if (!dirty) return 0;

  const open = await store.list({ project, status: 'open', limit: OPEN_LIMIT });
  const landed = open
    .filter((obs) => obs.files.length > 0 && obs.files.every((file) => !dirty.has(file)))
    .map((obs) => obs.id);

  return store.closeObservations(landed);
}

export async function openWork(store: MemoryStore, project: string): Promise<Observation[]> {
  const open = await store.list({ project, status: 'open', limit: OPEN_LIMIT });
  return open.sort((a, b) => b.createdAt - a.createdAt);
}
