import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CONFIG_DIR } from '../config/dir.js';
import { runDetached } from '../hooks/detached.js';
import type { DaemonReply, DaemonRequest } from './paths.js';
import { DAEMON_SCRIPT, socketPath } from './paths.js';

const FORWARDED = ['CLAUDE_DB_CAPTURE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_DB_USAGES_HOOK'];
const OWN_SETUP = ['CLAUDE_DB_URL', 'CLAUDE_DB_GRAPH_CACHE'];
const STARTING_FOR_MS = 15_000;
export const STARTING_PREFIX = 'daemon.starting.';

export type Asked = DaemonReply | { kind: 'unreachable' } | { kind: 'timeout' };

export function daemonWanted(env: NodeJS.ProcessEnv = process.env): boolean {
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

export function forwardedEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const name of FORWARDED) {
    const value = env[name];
    if (value !== undefined) picked[name] = value;
  }
  return picked;
}

export function askDaemon(request: DaemonRequest, timeoutMs: number): Promise<Asked> {
  return new Promise((settle) => {
    let sent = false;
    let reply = '';
    const socket = createConnection(socketPath());
    const finish = (asked: Asked): void => {
      clearTimeout(timer);
      socket.destroy();
      settle(asked);
    };
    const timer = setTimeout(
      () => finish(sent ? { kind: 'timeout' } : { kind: 'unreachable' }),
      timeoutMs,
    );
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      sent = true;
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on('data', (chunk: string) => {
      reply += chunk;
      const end = reply.indexOf('\n');
      if (end < 0) return;
      try {
        finish(JSON.parse(reply.slice(0, end)) as DaemonReply);
      } catch {
        finish({ kind: 'timeout' });
      }
    });
    socket.on('error', () => finish(sent ? { kind: 'timeout' } : { kind: 'unreachable' }));
    socket.on('close', () => finish(sent ? { kind: 'timeout' } : { kind: 'unreachable' }));
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
