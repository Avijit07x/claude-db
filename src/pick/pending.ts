import { randomUUID } from 'node:crypto';
import { renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR } from '../config/dir.js';
import { readJson, safeName, sweepOlderThan, writeJsonAtomic } from '../util/json-file.js';

const STALE_MS = 10 * 60 * 1000;
const ORPHAN_MS = 24 * 60 * 60 * 1000;
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface PickJob {
  project: string;
  prompt: string;
  previousReply: string;
  ids: string[];
  fallback: Ready | null;
}

export interface Ready {
  text: string;
  ids: string[];
}

interface Current {
  token: string;
  startedAt: number;
}

function folder(): string {
  return join(CONFIG_DIR, 'pick', 'pending');
}

function path(sessionId: string, suffix: string): string {
  return join(folder(), `${safeName(sessionId)}${suffix}`);
}

function isToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN.test(value);
}

export function clearPick(sessionId: string): void {
  const state = readJson<Current>(path(sessionId, '.json'));
  if (isToken(state?.token)) {
    rmSync(path(sessionId, `.${state.token}.job.json`), { force: true });
    rmSync(path(sessionId, `.${state.token}.ready.json`), { force: true });
  }
  rmSync(path(sessionId, '.json'), { force: true });
}

export function sweepPicks(now = Date.now()): void {
  sweepOlderThan(folder(), ORPHAN_MS, now);
}

export function startPick(sessionId: string, job: PickJob, now = Date.now()): string {
  clearPick(sessionId);
  const token = randomUUID();
  writeJsonAtomic(path(sessionId, `.${token}.job.json`), job);
  writeJsonAtomic(path(sessionId, '.json'), { token, startedAt: now } satisfies Current);
  return token;
}

export function takeJob(sessionId: string, token: string): PickJob | null {
  if (!isToken(token)) return null;
  const file = path(sessionId, `.${token}.job.json`);
  const job = readJson<PickJob>(file);
  rmSync(file, { force: true });
  const valid =
    typeof job?.project === 'string' &&
    typeof job.prompt === 'string' &&
    typeof job.previousReply === 'string' &&
    Array.isArray(job.ids) &&
    job.ids.every((id) => typeof id === 'string');
  return valid ? job : null;
}

function current(sessionId: string, now: number): Current | null {
  const state = readJson<Current>(path(sessionId, '.json'));
  if (!state || !isToken(state.token)) return null;
  return now - Number(state.startedAt) > STALE_MS ? null : state;
}

export function finishPick(
  sessionId: string,
  token: string,
  ready: Ready,
  now = Date.now(),
): boolean {
  if (current(sessionId, now)?.token !== token) return false;
  writeJsonAtomic(path(sessionId, `.${token}.ready.json`), ready);
  return true;
}

export function takeReady(sessionId: string, now = Date.now()): Ready | null {
  const state = current(sessionId, now);
  if (!state) return null;
  const ready = path(sessionId, `.${state.token}.ready.json`);
  const claimed = `${ready}.${randomUUID()}.taken`;
  try {
    renameSync(ready, claimed);
  } catch {
    return null;
  }
  const value = readJson<Ready>(claimed);
  rmSync(claimed, { force: true });
  return value && typeof value.text === 'string' && Array.isArray(value.ids) ? value : null;
}
