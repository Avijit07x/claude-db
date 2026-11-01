import { statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_DIR } from '../config/dir.js';
import { scopeToken } from '../util/scope.js';

export const DAEMON_SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'server.js');

export function socketPath(): string {
  if (process.platform === 'win32') return `\\\\.\\pipe\\claude-db-${scopeToken(CONFIG_DIR)}`;
  return join(CONFIG_DIR, 'daemon.sock');
}

export function buildId(): string {
  try {
    return `${DAEMON_SCRIPT}:${statSync(DAEMON_SCRIPT).mtimeMs}`;
  } catch {
    return DAEMON_SCRIPT;
  }
}

export interface DaemonRequest {
  build: string;
  hook: string;
  raw: string;
  env: Record<string, string>;
}

export type DaemonReply = { kind: 'done'; out: string } | { kind: 'stale' };
