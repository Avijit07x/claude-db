import { randomUUID } from 'node:crypto';
import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR } from '../config/index.js';
import { safeName } from '../util/json-file.js';

const WAIT_MS = 5_000;
const POLL_MS = 100;
const STALE_MS = 2 * 60_000;
const UNREADABLE_GRACE_MS = 5_000;

export interface FlushLockOptions {
  waitMs?: number;
  onTimeout?: 'run' | 'skip';
}

export type Locked<T> = { ran: true; value: T } | { ran: false };

const lockOf = (sessionId: string): string =>
  join(CONFIG_DIR, 'cursors', `${safeName(sessionId)}.lock`);

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readOpen(path: string): { text: string; mtimeMs: number } | null {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return null;
  }
  try {
    return { text: readFileSync(fd, 'utf8'), mtimeMs: fstatSync(fd).mtimeMs };
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

function abandoned(path: string, now: number): boolean {
  const held = readOpen(path);
  if (!held) return false;
  const age = now - held.mtimeMs;
  if (age > STALE_MS) return true;
  const pid = Number(held.text.split(' ')[0]);
  if (!Number.isInteger(pid) || pid <= 0) return age > UNREADABLE_GRACE_MS;
  return !alive(pid);
}

function tryLock(path: string, owner: string): boolean {
  try {
    writeFileSync(path, owner, { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

function release(path: string, owner: string): void {
  if (readOpen(path)?.text === owner) rmSync(path, { force: true });
}

function takeOver(lock: string, owner: string, now: number): boolean {
  const breaker = `${lock}.break`;
  if (!tryLock(breaker, owner)) {
    if (!abandoned(breaker, now)) return false;
    rmSync(breaker, { force: true });
    if (!tryLock(breaker, owner)) return false;
  }
  try {
    if (!abandoned(lock, now)) return false;
    rmSync(lock, { force: true });
    return tryLock(lock, owner);
  } finally {
    release(breaker, owner);
  }
}

async function acquire(lock: string, owner: string, waitMs: number): Promise<boolean> {
  mkdirSync(join(CONFIG_DIR, 'cursors'), { recursive: true });
  const until = Date.now() + waitMs;
  for (;;) {
    if (tryLock(lock, owner)) return true;
    if (abandoned(lock, Date.now()) && takeOver(lock, owner, Date.now())) return true;
    if (Date.now() >= until) return false;
    await new Promise((settle) => setTimeout(settle, POLL_MS));
  }
}

export async function withFlushLock<T>(
  sessionId: string,
  work: () => Promise<T>,
  { waitMs = WAIT_MS, onTimeout = 'run' }: FlushLockOptions = {},
): Promise<Locked<T>> {
  const lock = lockOf(sessionId);
  const owner = `${process.pid} ${randomUUID()}`;
  const held = await acquire(lock, owner, waitMs).catch(() => false);
  if (!held && onTimeout === 'skip') return { ran: false };
  try {
    return { ran: true, value: await work() };
  } finally {
    if (held) release(lock, owner);
  }
}
