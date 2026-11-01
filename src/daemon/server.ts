#!/usr/bin/env node
import { chmodSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { join } from 'node:path';
import { CONFIG_DIR, CONFIG_PATH, loadConfig } from '../config/index.js';
import { createContext } from '../context.js';
import type { RecallContext } from '../context.js';
import { parsePayload } from '../hooks/payload.js';
import type { HookRun } from '../hooks/run.js';
import { isHookName, loadHandler } from '../hooks/run.js';
import { silenceSqliteWarning } from '../util/warnings.js';
import type { DaemonReply, DaemonRequest } from './paths.js';
import { buildId, socketPath } from './paths.js';
import { STARTING_PREFIX } from './client.js';

silenceSqliteWarning();

const BUILD = buildId();
const SOCKET = socketPath();
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const RETIRE_AFTER_MS = 30_000;

let current: { stamp: number; ctx: Promise<RecallContext> } | null = null;
let running = 0;
const pending = new Set<Promise<void>>();
let idleTimer: NodeJS.Timeout | undefined;
let server: Server | undefined;
let closing = false;

const log = (message: string): void => {
  process.stderr.write(`${new Date().toISOString()} daemon ${message}\n`);
};

function configStamp(): number {
  try {
    return statSync(CONFIG_PATH).mtimeMs;
  } catch {
    return 0;
  }
}

function retire(ctx: Promise<RecallContext>): void {
  setTimeout(() => {
    ctx.then((old) => old.close()).catch(() => undefined);
  }, RETIRE_AFTER_MS).unref();
}

function context(): Promise<RecallContext> {
  const stamp = configStamp();
  if (current && current.stamp === stamp) return current.ctx;
  if (current) retire(current.ctx);
  const ctx = createContext();
  current = { stamp, ctx };
  ctx.catch(() => {
    if (current?.ctx === ctx) current = null;
  });
  return ctx;
}

function idleMs(): number {
  try {
    return loadConfig().daemon.idleMinutes * 60_000;
  } catch {
    return 15 * 60_000;
  }
}

function touch(): void {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (running === 0 && pending.size === 0) void shutdown('idle');
    else touch();
  }, idleMs());
}

function track(task: () => Promise<void>): boolean {
  const done = task()
    .catch((error: unknown) => log(`background task failed: ${String(error)}`))
    .finally(() => {
      pending.delete(done);
      touch();
    });
  pending.add(done);
  return true;
}

async function answer(request: DaemonRequest): Promise<DaemonReply> {
  if (request.build !== BUILD) {
    setImmediate(() => void shutdown('replaced by a newer build'));
    return { kind: 'stale' };
  }
  if (request.hook === '__stop') {
    setImmediate(() => void shutdown('asked to stop'));
    return { kind: 'done', out: '' };
  }
  if (!isHookName(request.hook)) return { kind: 'done', out: '' };

  const out: string[] = [];
  const run: HookRun = {
    payload: parsePayload(request.raw),
    env: request.env,
    write: (text) => out.push(text),
    withContext: async (work) => work(await context()),
    inDaemon: track,
  };
  try {
    const handle = await loadHandler(request.hook);
    await handle(run);
  } catch (error) {
    log(`${request.hook} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { kind: 'done', out: out.join('') };
}

function serve(socket: Socket): void {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('error', () => socket.destroy());
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    if (buffer.length > MAX_REQUEST_BYTES) {
      socket.destroy();
      return;
    }
    const end = buffer.indexOf('\n');
    if (end < 0) return;
    const line = buffer.slice(0, end);
    buffer = '';
    socket.pause();
    running += 1;
    touch();
    let request: DaemonRequest;
    try {
      request = JSON.parse(line) as DaemonRequest;
    } catch {
      running -= 1;
      socket.destroy();
      return;
    }
    void answer(request)
      .then((reply) => socket.end(`${JSON.stringify(reply)}\n`))
      .finally(() => {
        running -= 1;
        touch();
      });
  });
}

async function shutdown(reason: string): Promise<void> {
  if (closing) return;
  closing = true;
  log(`stopping: ${reason}`);
  clearTimeout(idleTimer);
  server?.close();
  await Promise.allSettled([...pending]);
  if (process.platform !== 'win32') rmSync(SOCKET, { force: true });
  if (current) await current.ctx.then((ctx) => ctx.close()).catch(() => undefined);
  process.exit(0);
}

function clearStartMarkers(): void {
  try {
    for (const name of readdirSync(CONFIG_DIR)) {
      if (name.startsWith(STARTING_PREFIX)) rmSync(join(CONFIG_DIR, name), { force: true });
    }
  } catch {
    return;
  }
}

function inUse(): Promise<boolean> {
  return new Promise((settle) => {
    const probe = createConnection(SOCKET);
    probe.on('connect', () => {
      probe.destroy();
      settle(true);
    });
    probe.on('error', () => settle(false));
  });
}

async function start(): Promise<void> {
  if (await inUse()) {
    log('another daemon is already running');
    return;
  }
  if (process.platform !== 'win32') rmSync(SOCKET, { force: true });
  server = createServer(serve);
  server.on('error', (error) => {
    log(`could not listen: ${error.message}`);
    process.exit(0);
  });
  server.listen(SOCKET, () => {
    if (process.platform !== 'win32') chmodSync(SOCKET, 0o600);
    clearStartMarkers();
    log(`listening on ${SOCKET}`);
    touch();
    void context()
      .then((ctx) => ctx.embedder())
      .catch((error: unknown) => log(`could not open the store: ${String(error)}`));
  });
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

await start();
