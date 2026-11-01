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

function abandoned(lock: string, now: number): boolean {
  let fd: number;
  try {
    fd = openSync(lock, 'r');
  } catch {
    return false;
  }
  try {
    if (now - fstatSync(fd).mtimeMs > STALE_MS) return true;
    const pid = Number(readFileSync(fd, 'utf8'));
    return !Number.isInteger(pid) || pid <= 0 || !alive(pid);
  } catch {
    return false;
  } finally {
    closeSync(fd);
  }
}

function tryLock(lock: string): boolean {
  try {
    writeFileSync(lock, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

async function acquire(lock: string, waitMs: number): Promise<boolean> {
  mkdirSync(join(CONFIG_DIR, 'cursors'), { recursive: true });
  const until = Date.now() + waitMs;
  for (;;) {
    if (tryLock(lock)) return true;
    if (abandoned(lock, Date.now())) {
      rmSync(lock, { force: true });
      continue;
    }
    if (Date.now() >= until) return false;
    await new Promise((settle) => setTimeout(settle, POLL_MS));
  }
}

export async function withFlushLock<T>(
  sessionId: string,
  work: () => Promise<T>,
  waitMs = WAIT_MS,
): Promise<T> {
  const lock = lockOf(sessionId);
  const held = await acquire(lock, waitMs).catch(() => false);
  try {
    return await work();
  } finally {
    if (held) rmSync(lock, { force: true });
  }
}
