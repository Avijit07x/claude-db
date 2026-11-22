import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR } from '../config/dir.js';

const pidPath = (): string => join(CONFIG_DIR, 'daemon.pid');

export function readDaemonPid(): number | null {
  try {
    const pid = Number(readFileSync(pidPath(), 'utf8'));
    return Number.isInteger(pid) && pid > 1 ? pid : null;
  } catch {
    return null;
  }
}

export function writeDaemonPid(): void {
  writeFileSync(pidPath(), String(process.pid));
}

export function clearDaemonPid(pid: number): void {
  if (readDaemonPid() === pid) rmSync(pidPath(), { force: true });
}
