import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CONFIG_DIR } from '../config/dir.js';
import { runDetached } from '../hooks/detached.js';
import { hookEnv } from '../util/env.js';
import { clearDaemonPid, readDaemonPid } from './pid.js';
import type { DaemonMessage, DaemonReply, DaemonRequest } from './paths.js';
import { DAEMON_SCRIPT, socketPath } from './paths.js';

const OWN_SETUP = ['CLAUDE_DB_URL', 'CLAUDE_DB_GRAPH_CACHE'];
const STARTING_FOR_MS = 15_000;
const ACK_MS = 2_000;
export const STARTING_PREFIX = 'daemon.starting.';

export type Asked =
  DaemonReply | { kind: 'unreachable' } | { kind: 'silent' } | { kind: 'timeout' };

export function daemonWanted(env: NodeJS.ProcessEnv = hookEnv()): boolean {
  if (OWN_SETUP.some((name) => env[name])) return false;
  const forced = env['CLAUDE_DB_DAEMON'];
  if (forced === 'on') return true;
  if (forced === 'off') return false;
  try {
    const config = JSON.parse(readFileSync(join(CONFIG_DIR, 'config.json'), 'utf8')) as {
      daemon?: { enabled?: unknown };
    };
    return config.daemon?.enabled === true;
  } catch {
    return false;
  }
}

export function envForDaemon(env: NodeJS.ProcessEnv = hookEnv()): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) picked[name] = value;
  }
  return picked;
}

function parseMessage(line: string): DaemonMessage | null {
  try {
    return JSON.parse(line) as DaemonMessage;
  } catch {
    return null;
  }
}

export function askDaemon(request: DaemonRequest, replyMs: number): Promise<Asked> {
  return new Promise((settle) => {
    let sent = false;
    let buffer = '';
    const socket = createConnection(socketPath());
    const finish = (asked: Asked): void => {
      clearTimeout(timer);
      socket.destroy();
      settle(asked);
    };
    const failed = (): Asked => (sent ? { kind: 'timeout' } : { kind: 'unreachable' });
    let timer = setTimeout(() => finish({ kind: 'silent' }), ACK_MS);
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      sent = true;
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
        const message = parseMessage(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (message?.kind !== 'ack') {
          finish(message ?? { kind: 'timeout' });
          return;
        }
        clearTimeout(timer);
        timer = setTimeout(() => finish({ kind: 'timeout' }), replyMs);
      }
    });
    socket.on('error', () => finish(failed()));
    socket.on('close', () => finish(failed()));
  });
}

export function startDaemon(now = Date.now()): boolean {
  const window = Math.floor(now / STARTING_FOR_MS);
  const marker = join(CONFIG_DIR, `${STARTING_PREFIX}${window}`);
  try {
    writeFileSync(marker, String(now), { flag: 'wx' });
  } catch {
    return false;
  }
  runDetached(DAEMON_SCRIPT, [], homedir(), () => rmSync(marker, { force: true }));
  return true;
}

export function replaceDaemon(asked: number | null): void {
  if (asked !== null) {
    try {
      process.kill(asked, 'SIGKILL');
    } catch {}
  }
  if (readDaemonPid() === asked) {
    if (asked !== null) clearDaemonPid(asked);
    if (process.platform !== 'win32') rmSync(socketPath(), { force: true });
  }
  startDaemon();
}
