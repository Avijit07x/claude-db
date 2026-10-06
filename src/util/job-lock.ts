import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR } from '../config/index.js';
import { scopeToken } from './scope.js';

const STALE_LOCK_MS = 10 * 60_000;

function jobDir(job: string): string {
  return join(CONFIG_DIR, job);
}

function lockPath(job: string, key: string): string {
  return join(jobDir(job), `${scopeToken(key)}.lock`);
}

function markPath(job: string, key: string): string {
  return join(jobDir(job), `${scopeToken(key)}.done`);
}

export function jobMark(job: string, key: string): number {
  try {
    return Number(readFileSync(markPath(job, key), 'utf8')) || 0;
  } catch {
    return 0;
  }
}

export function claimJob(job: string, key: string, now = Date.now()): boolean {
  const lock = lockPath(job, key);
  mkdirSync(jobDir(job), { recursive: true });
  if (tryLock(lock, now)) return true;

  let lockedAt: number;
  try {
    lockedAt = statSync(lock).mtimeMs;
  } catch {
    return tryLock(lock, now);
  }
  if (now - lockedAt < STALE_LOCK_MS) return false;
  rmSync(lock, { force: true });
  return tryLock(lock, now);
}

export function finishJob(job: string, key: string, mark: number): void {
  mkdirSync(jobDir(job), { recursive: true });
  writeFileSync(markPath(job, key), String(mark), 'utf8');
  rmSync(lockPath(job, key), { force: true });
}

export function releaseJob(job: string, key: string): void {
  rmSync(lockPath(job, key), { force: true });
}

function tryLock(lock: string, now: number): boolean {
  try {
    writeFileSync(lock, String(now), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}
