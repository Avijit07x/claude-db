import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CLI = resolve(DIST, 'cli', 'index.js');
export const PICK_WORKER = resolve(DIST, 'pick', 'worker.js');

export function runDetached(
  script: string,
  args: string[],
  cwd: string,
  release: () => void,
): void {
  try {
    spawn(process.execPath, [script, ...args], { cwd, detached: true, stdio: 'ignore' })
      .on('error', release)
      .unref();
  } catch {
    release();
  }
}
