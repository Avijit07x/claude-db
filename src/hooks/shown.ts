import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CONFIG_DIR } from '../config/index.js';

const LIMIT = 300;

function shownPath(sessionId: string): string {
  return join(CONFIG_DIR, 'cursors', `${sessionId.replace(/[^\w-]/g, '_')}.shown`);
}

export function readShown(sessionId: string): Set<string> {
  try {
    return new Set(readFileSync(shownPath(sessionId), 'utf8').split('\n').filter(Boolean));
  } catch {
    return new Set();
  }
}

export function markShown(sessionId: string, ids: string[]): void {
  if (ids.length === 0) return;
  const path = shownPath(sessionId);
  const kept = [...readShown(sessionId), ...ids].slice(-LIMIT);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${[...new Set(kept)].join('\n')}\n`, 'utf8');
  } catch {}
}
