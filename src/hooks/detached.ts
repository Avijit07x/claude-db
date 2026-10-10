import { spawn } from 'node:child_process';
import { appendFileSync, closeSync, mkdirSync, openSync, renameSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_DIR } from '../config/dir.js';

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CLI = resolve(DIST, 'cli', 'index.js');
export const PICK_WORKER = resolve(DIST, 'pick', 'worker.js');
export const TURN_WORKER = resolve(DIST, 'hooks', 'turn-save.js');

const LOG_LIMIT = 1024 * 1024;

export const backgroundLog = (): string => join(CONFIG_DIR, 'logs', 'background.log');

function rotate(path: string): void {
  try {
    if (statSync(path).size > LOG_LIMIT) renameSync(path, `${path}.1`);
  } catch {
    return;
  }
}

function openLog(script: string, args: string[]): number | 'ignore' {
  try {
    const path = backgroundLog();
    mkdirSync(dirname(path), { recursive: true });
    rotate(path);
    const name = script === CLI ? (args[0] ?? 'cli') : basename(script, '.js');
    appendFileSync(path, `${new Date().toISOString()} ${name} started\n`);
    return openSync(path, 'a');
  } catch {
    return 'ignore';
  }
}

export function runDetached(
  script: string,
  args: string[],
  cwd: string,
  release: () => void,
): void {
  const log = openLog(script, args);
  try {
    spawn(process.execPath, [script, ...args], {
      cwd,
      detached: true,
      stdio: ['ignore', log, log],
    })
      .on('error', release)
      .unref();
  } catch {
    release();
  } finally {
    if (typeof log === 'number') closeSync(log);
  }
}
