import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export function safeName(id: string): string {
  return id.replace(/[^\w-]/g, '_');
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value), 'utf8');
  renameSync(temp, file);
}

export function sweepOlderThan(folder: string, maxAgeMs: number, now = Date.now()): void {
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    return;
  }
  for (const name of names) {
    const file = join(folder, name);
    try {
      if (now - statSync(file).mtimeMs > maxAgeMs) rmSync(file, { force: true });
    } catch {}
  }
}
