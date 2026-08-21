import { join } from 'node:path';
import { readText, writeAtomic } from './files.js';
import { rmSync } from 'node:fs';

export const BLOCK_START = '<!-- claude-db:start -->';

export const BLOCK_END = '<!-- claude-db:end -->';

export const INSTRUCTIONS = [
  BLOCK_START,
  '## Project memory',
  '',
  'You have persistent memory of this project: your past sessions, decisions',
  'and their reasoning, served by the `memory` MCP server. Session summaries',
  'are injected at startup and the best matching observation is injected above',
  'each prompt, but that is only ever a slice of what you know.',
  '',
  'Recall the rest *before* re-deriving something you already learned. That',
  'means before grepping or reading git history to reconstruct why something is',
  'the way it is, before saying you lack context, and before asking the user to',
  're-explain a past decision or a failed approach: call `search`, then',
  '`get_observations` for the ids worth reading.',
  '',
  'Verifying against the code afterwards is right — memory records what was',
  'done, the source shows what is. Starting there is what wastes the memory.',
  '',
  '`search` covers *why*: past decisions, bugs, reasoning. `find_usages` is',
  'the default the moment a question is about a symbol or identifier — before',
  'editing or removing a shared or exported name, or to look one up at all —',
  'since it tags the likely definition and re-derives the answer from the',
  'current source on every call, so it is never stale. grep still wins for',
  'everything that is not a code identifier: plain text, log files, comments,',
  'strings, and scoping with grep flags `find_usages` does not expose.',
  '',
  'When the user states a standing rule or preference, record it with',
  '`remember` so it survives this session.',
  BLOCK_END,
].join('\n');

export function writeInstructions(path: string): void {
  const rest = withoutBlock(readText(path)).trimEnd();
  const body = rest.length > 0 ? `${rest}\n\n${INSTRUCTIONS}\n` : `${INSTRUCTIONS}\n`;
  writeAtomic(path, body);
}

export function removeInstructions(path: string): void {
  const existing = readText(path);
  if (!existing.includes(BLOCK_START)) return;

  const rest = withoutBlock(existing).trim();
  if (rest.length === 0) rmSync(path, { force: true });
  else writeAtomic(path, `${rest}\n`);
}

function withoutBlock(text: string): string {
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END);
  if (start === -1 || end === -1 || end < start) return text;
  return `${text.slice(0, start)}${text.slice(end + BLOCK_END.length)}`.replace(/\n{3,}/g, '\n\n');
}
