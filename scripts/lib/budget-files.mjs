import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function expirePause(name) {
  const path = join(homedir(), '.claude-memory', name, 'budget.json');
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(path, `${JSON.stringify({ ...saved, pausedUntil: 1 })}\n`);
}
