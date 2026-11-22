import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CONFIG_DIR } from '../config/index.js';
import { sessionIdsOnDisk } from './transcript.js';

const SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;
const LEGACY_FILE = /\.(written|lock|lock\.break)$/;

function cursorName(sessionId: string): string {
  return `${sessionId.replace(/[^\w-]/g, '_')}.offset`;
}

function cursorPath(sessionId: string): string {
  return join(CONFIG_DIR, 'cursors', cursorName(sessionId));
}

export function readCursor(sessionId: string): number {
  try {
    const value = Number.parseInt(readFileSync(cursorPath(sessionId), 'utf8'), 10);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function writeCursor(sessionId: string, offset: number): void {
  const path = cursorPath(sessionId);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, String(offset), 'utf8');
  } catch {}
}

export function resetCursor(sessionId: string): void {
  writeCursor(sessionId, 0);
}

export function clearCursor(sessionId: string): void {
  rmSync(cursorPath(sessionId), { force: true });
  rmSync(cursorPath(sessionId).replace(/\.offset$/, '.shown'), { force: true });
}

export function sweepCursorsDaily(now = Date.now()): number {
  const marker = join(CONFIG_DIR, 'cursors', '.swept');
  let lastSweep = 0;
  try {
    lastSweep = Number(readFileSync(marker, 'utf8')) || 0;
  } catch {}
  if (now - lastSweep < SWEEP_EVERY_MS) return 0;
  try {
    mkdirSync(dirname(marker), { recursive: true });
    writeFileSync(marker, String(now), 'utf8');
  } catch {
    return 0;
  }
  return sweepCursors();
}

export function sweepCursors(): number {
  const dir = join(CONFIG_DIR, 'cursors');
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return 0;
  }

  const legacy = files.filter((file) => LEGACY_FILE.test(file));
  for (const file of legacy) rmSync(join(dir, file), { force: true });

  const onDisk = sessionIdsOnDisk();
  if (onDisk === null) return legacy.length;
  const live = new Set(onDisk.map((id) => id.replace(/[^\w-]/g, '_')));
  let removed = legacy.length;
  for (const file of files) {
    const match = /^(.+)\.(offset|shown)$/.exec(file);
    if (!match?.[1] || live.has(match[1])) continue;
    rmSync(join(dir, file), { force: true });
    removed += 1;
  }
  return removed;
}
