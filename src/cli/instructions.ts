import { readText, writeAtomic } from './files.js';
import { rmSync } from 'node:fs';

export const BLOCK_START = '<!-- claude-db:start -->';

export const BLOCK_END = '<!-- claude-db:end -->';

export function removeInstructions(path: string): boolean {
  const existing = readText(path);
  const stripped = withoutBlock(existing);
  if (stripped === existing) return false;

  const rest = stripped.trim();
  if (rest.length === 0) rmSync(path, { force: true });
  else writeAtomic(path, `${rest}\n`);
  return true;
}

function withoutBlock(text: string): string {
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END);
  if (start === -1 || end === -1 || end < start) return text;
  return `${text.slice(0, start)}${text.slice(end + BLOCK_END.length)}`.replace(/\n{3,}/g, '\n\n');
}
