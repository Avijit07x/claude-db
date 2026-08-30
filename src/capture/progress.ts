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
    const files = new Set<string>();
    const fields = raw.split('\0');
    for (let i = 0; i < fields.length; i += 1) {
      const entry = fields[i];
      if (entry === undefined || entry.length <= 3) continue;
      files.add(join(project, entry.slice(3)));
      if (/^[RC]/.test(entry) || /^.[RC]/.test(entry)) {
        const origin = fields[i + 1];
        if (origin !== undefined && origin.length > 0) files.add(join(project, origin));
        i += 1;
      }
    }
    return files;
  } catch {
    return null;
  }
}

export async function closeLandedWork(store: MemoryStore, project: string): Promise<number> {
  const dirty = uncommittedFiles(project);
  if (!dirty) return 0;

  const landed: string[] = [];
  let after: number | undefined;
  let afterId: string | undefined;

  for (;;) {
    const batch = await store.list({
      project,
      status: 'open',
      ...(after === undefined ? {} : { after }),
      ...(afterId === undefined ? {} : { afterId }),
      limit: OPEN_LIMIT,
    });
    if (batch.length === 0) break;

    for (const obs of batch) {
      if (obs.files.every((file) => !dirty.has(file))) landed.push(obs.id);
    }

    const last = batch[batch.length - 1];
    if (!last) break;
    after = last.createdAt;
    afterId = last.id;
    if (batch.length < OPEN_LIMIT) break;
  }

  return store.closeObservations(landed);
}

export async function openWork(store: MemoryStore, project: string): Promise<Observation[]> {
  const open = await store.list({ project, status: 'open', limit: OPEN_LIMIT, newest: true });
  return open.sort((a, b) => b.createdAt - a.createdAt);
}
