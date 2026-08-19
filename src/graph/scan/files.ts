import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { languageFor } from '../languages/index.js';
import type { LanguageSpec } from '../languages/index.js';

const MAX_BUFFER = 64 * 1024 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;

export interface SourceFile {
  path: string;
  spec: LanguageSpec;
  source: string;
  hash: string;
}

export function hashOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 32);
}

export function listFiles(root: string): string[] {
  const list = (args: string[]): string[] =>
    execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
    })
      .split('\0')
      .filter((path) => path.length > 0);

  const tracked = list(['ls-files', '-z']);
  const untracked = list(['ls-files', '-z', '--others', '--exclude-standard']);
  return [...new Set([...tracked, ...untracked])].sort();
}

export function sourceFiles(root: string): string[] {
  return listFiles(root).filter((path) => languageFor(path) !== null);
}

export function readSource(root: string, path: string): SourceFile | null {
  const spec = languageFor(path);
  if (!spec) return null;

  let bytes: Buffer;
  try {
    bytes = readFileSync(join(root, path));
  } catch {
    return null;
  }
  if (bytes.length > MAX_FILE_BYTES || bytes.includes(0)) return null;

  return { path, spec, source: bytes.toString('utf8'), hash: hashOf(bytes) };
}

export function currentHashes(root: string): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const path of sourceFiles(root)) {
    try {
      hashes.set(path, hashOf(readFileSync(join(root, path))));
    } catch {
      continue;
    }
  }
  return hashes;
}
