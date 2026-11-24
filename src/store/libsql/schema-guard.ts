import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CONFIG_DIR } from '../../config/dir.js';
import type { Client } from './driver.js';

const MISSING_TABLE = /no such table/i;

export function databaseId(uri: string): string {
  return createHash('sha256')
    .update(uri.replace(/[?#].*$/, ''))
    .digest('hex')
    .slice(0, 16);
}

export function markerPath(uri: string, dir = join(CONFIG_DIR, 'libsql-schema')): string {
  return join(dir, databaseId(uri));
}

export function readMarker(path: string): number | null {
  try {
    const version = Number(readFileSync(path, 'utf8').trim());
    return Number.isInteger(version) ? version : null;
  } catch {
    return null;
  }
}

export function writeMarker(path: string, version: number): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const staging = `${path}.${process.pid}.tmp`;
    writeFileSync(staging, `${version}\n`, 'utf8');
    renameSync(staging, path);
  } catch {
    return;
  }
}

export function clearMarker(path: string): void {
  rmSync(path, { force: true });
}

export function guarded(client: Client, ensureSchema: () => Promise<void>): Client {
  const retried = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (!MISSING_TABLE.test(String(error))) throw error;
      await ensureSchema();
      return work();
    }
  };
  return {
    execute: (statement) => retried(() => client.execute(statement)),
    batch: (statements, mode) => retried(() => client.batch(statements, mode)),
    close: () => client.close(),
  };
}
