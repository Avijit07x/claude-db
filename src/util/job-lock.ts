import { mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
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

const BREAKER_STALE_MS = 30_000;
const KEEP_EVERY_MS = 60_000;

function ageOf(path: string, now: number): number | null {
  try {
    return now - statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

function breakStaleLock(lock: string, now: number): boolean {
  const breaker = `${lock}.break`;
  if (!tryLock(breaker, now)) {
    const age = ageOf(breaker, now);
    if (age === null || age < BREAKER_STALE_MS) return false;
    rmSync(breaker, { force: true });
    if (!tryLock(breaker, now)) return false;
  }
  try {
    const age = ageOf(lock, now);
    if (age !== null && age < STALE_LOCK_MS) return false;
    rmSync(lock, { force: true });
    return tryLock(lock, now);
  } finally {
    rmSync(breaker, { force: true });
  }
}

export function claimJob(job: string, key: string, now = Date.now()): boolean {
  const lock = lockPath(job, key);
  mkdirSync(jobDir(job), { recursive: true });
  if (tryLock(lock, now)) return true;
  const age = ageOf(lock, now);
  if (age === null) return tryLock(lock, now);
  if (age < STALE_LOCK_MS) return false;
  return breakStaleLock(lock, now);
}

export function keepJob(job: string, key: string): () => void {
  const lock = lockPath(job, key);
  const timer = setInterval(() => {
    try {
      const at = new Date();
      utimesSync(lock, at, at);
    } catch {
      clearInterval(timer);
    }
  }, KEEP_EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
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
