import { dirname } from 'node:path';
import { mkdirSync, readFileSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';

export function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

export function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, content, 'utf8');
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

export function readJson(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function writeJson(path: string, value: unknown): void {
  writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeJsonOrRemove(path: string, value: Record<string, unknown>): void {
  if (Object.keys(value).length === 0) rmSync(path, { force: true });
  else writeJson(path, value);
}

export function removeIfEmpty(path: string): void {
  try {
    rmdirSync(path);
  } catch {
    return;
  }
}
