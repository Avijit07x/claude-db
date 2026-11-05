import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CONFIG_DIR } from '../config/index.js';
import { sessionIdsOnDisk } from './transcript.js';

const SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;

function cursorName(sessionId: string): string {
  return `${sessionId.replace(/[^\w-]/g, '_')}.offset`;
}

function cursorPath(sessionId: string): string {
  return join(CONFIG_DIR, 'cursors', cursorName(sessionId));
}

const writtenPath = (sessionId: string): string =>
  cursorPath(sessionId).replace(/\.offset$/, '.written');

export function readWritten(sessionId: string): Map<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(writtenPath(sessionId), 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return new Map();
    return new Map(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return new Map();
  }
}

export function writeWritten(sessionId: string, prints: ReadonlyMap<string, string>): void {
  const path = writtenPath(sessionId);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(Object.fromEntries(prints)), 'utf8');
  } catch {}
}

export function readCursor(sessionId: string): number {
  try {
    const value = Number.parseInt(readFileSync(cursorPath(sessionId), 'utf8'), 10);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function advanceCursor(sessionId: string, from: number, to: number): void {
  const now = readCursor(sessionId);
  if (now !== from && now > to) return;
  writeCursor(sessionId, to);
}

function writeCursor(sessionId: string, offset: number): void {
  const path = cursorPath(sessionId);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, String(offset), 'utf8');
  } catch {}
}

export function resetCursor(sessionId: string): void {
  writeCursor(sessionId, 0);
  rmSync(writtenPath(sessionId), { force: true });
}

export function clearCursor(sessionId: string): void {
  rmSync(cursorPath(sessionId), { force: true });
  rmSync(cursorPath(sessionId).replace(/\.offset$/, '.shown'), { force: true });
  rmSync(writtenPath(sessionId), { force: true });
}

export function sweepCursorsDaily(now = Date.now()): number {
  const marker = join(CONFIG_DIR, 'cursors', '.swept');
  try {
    if (now - statSync(marker).mtimeMs < SWEEP_EVERY_MS) return 0;
  } catch {}
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

  const live = new Set(sessionIdsOnDisk().map((id) => id.replace(/[^\w-]/g, '_')));
  let removed = 0;
  for (const file of files) {
    const match = /^(.+)\.(offset|shown|written)$/.exec(file);
    if (!match?.[1] || live.has(match[1])) continue;
    rmSync(join(dir, file), { force: true });
    removed += 1;
  }
  return removed;
}
