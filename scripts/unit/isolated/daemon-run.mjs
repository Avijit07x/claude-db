import '../../lib/require-isolated.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { report } from '../../lib/isolated.mjs';
import { createContext } from '../../../dist/context.js';
import { recoverAfterCompact } from '../../../dist/hooks/compact.js';
import { runDetached } from '../../../dist/hooks/detached.js';
import { withHookEnv } from '../../../dist/util/env.js';
import { remember, transcriptPathFor } from '../../../dist/capture/index.js';

const dist = new URL('../../../dist/', import.meta.url).pathname;
const memory = join(homedir(), '.claude-memory');
const socket = join(memory, 'daemon.sock');
mkdirSync(join(homedir(), 'shop', '.git'), { recursive: true });
const project = realpathSync(join(homedir(), 'shop'));
mkdirSync(memory, { recursive: true });
writeFileSync(
  join(memory, 'config.json'),
  JSON.stringify({
    database: join(homedir(), 'memory.db'),
    daemon: { enabled: true },
    distill: { enabled: false },
    pick: { enabled: false },
    capture: { summarize: 'on' },
    updates: 'off',
  }),
);

const env = { ...process.env };
delete env.CLAUDE_DB_URL;
delete env.CLAUDE_DB_GRAPH_CACHE;
const payload = JSON.stringify({
  hook_event_name: 'SessionStart',
  source: 'startup',
  cwd: project,
});
const hook = (name, extra = {}, input = payload, timeout = 0) =>
  spawnSync(process.execPath, [join(dist, 'hooks', `${name}.js`)], {
    input,
    env: { ...env, ...extra },
    encoding: 'utf8',
    timeout,
  });
const cli = (...args) =>
  spawnSync(process.execPath, [join(dist, 'cli', 'index.js'), ...args], { env, encoding: 'utf8' });
const until = async (test, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!test() && Date.now() < end) await new Promise((settle) => setTimeout(settle, 50));
  return test();
};

{
  const seeded = await createContext({ database: join(homedir(), 'memory.db') });
  try {
    await remember(seeded, { project, kind: 'preference', text: 'Keep replies short and plain' });
  } finally {
    await seeded.close();
  }
}

const once = hook('session-start', { CLAUDE_DB_DAEMON: 'off' });
const local = hook('session-start', { CLAUDE_DB_DAEMON: 'off' });
report(
  'with the daemon off the hook runs in its own process',
  once.status === 0 && local.status === 0 && local.stdout.length > 0 && !existsSync(socket),
);

const first = hook('session-start');
report(
  'the first hook with no daemon answers by itself and starts one',
  first.stdout === local.stdout && (await until(() => existsSync(socket))),
  first.stdout.slice(0, 80),
);
report('the status command sees it', /running/.test(cli('daemon').stdout));

const served = hook('session-start');
report(
  'a hook served by the daemon prints what it prints on its own',
  served.status === 0 && served.stdout === local.stdout,
  served.stdout.slice(0, 80),
);

const logFile = join(memory, 'logs', 'background.log');
report(
  'the daemon logs where it listens',
  readFileSync(logFile, 'utf8').includes('daemon listening'),
);

const raw = spawn(process.execPath, [join(dist, 'daemon', 'server.js')], { env, stdio: 'ignore' });
const second = await new Promise((settle) => raw.on('exit', (code) => settle(code)));
report('a second daemon sees the first and exits', second === 0 && existsSync(socket));

const sessionId = randomUUID();
const transcript = join(homedir(), `${sessionId}.jsonl`);
const at = new Date().toISOString();
writeFileSync(
  transcript,
  [
    { type: 'user', timestamp: at, message: { content: 'make the order feed reconnect' } },
    {
      type: 'assistant',
      timestamp: at,
      message: {
        content: [
          { type: 'text', text: 'The feed reconnects with backoff.' },
          {
            type: 'tool_use',
            id: randomUUID(),
            name: 'Edit',
            input: { file_path: join(project, 'feed.ts') },
          },
        ],
      },
    },
  ]
    .map((entry) => JSON.stringify(entry))
    .join('\n') + '\n',
);
const stop = spawnSync(process.execPath, [join(dist, 'hooks', 'turn-end.js')], {
  input: JSON.stringify({
    session_id: sessionId,
    hook_event_name: 'Stop',
    cwd: project,
    transcript_path: transcript,
    last_assistant_message: 'The feed reconnects with backoff.',
  }),
  env,
  encoding: 'utf8',
});
const saved = async () => {
  const ctx = await createContext({ database: join(homedir(), 'memory.db') });
  try {
    return (await ctx.store.list({ project, sessionId, limit: 10 })).length;
  } finally {
    await ctx.close();
  }
};
let rows = 0;
const end = Date.now() + 10_000;
while (rows === 0 && Date.now() < end) {
  rows = await saved();
  if (rows === 0) await new Promise((settle) => setTimeout(settle, 100));
}
report('the daemon saves a finished turn itself', stop.status === 0 && rows > 0, rows);

const sendRaw = (text) =>
  new Promise((settle) => {
    const client = createConnection(socket);
    client.on('connect', () => client.write(text));
    client.on('close', () => settle());
    client.on('error', () => settle());
  });
const starts = () => readFileSync(logFile, 'utf8').split('daemon listening').length - 1;
const startsBefore = starts();
await sendRaw('null\n');
await sendRaw('{"hook":"session-start"}\n');
const afterJunk = hook('session-start');
report(
  'a malformed request is dropped and the daemon keeps serving',
  afterJunk.status === 0 &&
    afterJunk.stdout === hook('session-start', { CLAUDE_DB_DAEMON: 'off' }).stdout &&
    starts() === startsBefore,
  `${starts() - startsBefore} restart(s)`,
);

const marker = join(homedir(), 'worker-env.txt');
const probe = join(homedir(), 'worker-env.mjs');
writeFileSync(
  probe,
  `import { writeFileSync } from 'node:fs';\n` +
    `writeFileSync(${JSON.stringify(marker)}, process.env.CLAUDE_DB_WORKER_MARK ?? 'none');\n`,
);
withHookEnv({ ...process.env, CLAUDE_DB_WORKER_MARK: 'from-hook' }, () =>
  runDetached(probe, [], homedir(), () => {}),
);
report(
  'a worker started for a hook gets that hook env, not the daemon env',
  (await until(() => existsSync(marker))) && readFileSync(marker, 'utf8') === 'from-hook',
);

{
  const quietId = randomUUID();
  const quietTranscript = join(homedir(), `${quietId}.jsonl`);
  writeFileSync(quietTranscript, readFileSync(transcript, 'utf8'));
  const ctx = await createContext({ database: join(homedir(), 'memory.db') });
  try {
    await recoverAfterCompact(ctx, project, quietId, quietTranscript, {
      CLAUDE_DB_CAPTURE: 'off',
    });
    const quiet = await ctx.store.list({ project, sessionId: quietId, limit: 10 });
    report('compacting a chat with capture off saves nothing', quiet.length === 0, quiet.length);
  } finally {
    await ctx.close();
  }
}

const script = join(dist, 'daemon', 'server.js');
const { atime, mtime } = statSync(script);
utimesSync(script, atime, new Date(mtime.getTime() + 1000));
try {
  const after = hook('session-start');
  const fresh = hook('session-start', { CLAUDE_DB_DAEMON: 'off' });
  report(
    'a hook from a newer build replaces the running daemon and still answers',
    after.stdout === fresh.stdout &&
      (await until(() => readFileSync(logFile, 'utf8').includes('replaced by a newer build'))),
    after.stdout.slice(0, 80),
  );
} finally {
  utimesSync(script, atime, mtime);
}
await until(() => existsSync(socket));

const fakeClaude = (name) => {
  const path = join(homedir(), `claude-${name}.mjs`);
  const seen = join(homedir(), `claude-${name}.seen`);
  writeFileSync(
    path,
    `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\n` +
      `writeFileSync(${JSON.stringify(seen)}, process.env.CLAUDE_CONFIG_DIR ?? 'none');\n` +
      `process.stdout.write('Reworked the order feed.');\n`,
  );
  chmodSync(path, 0o755);
  return { path, seen };
};
const startRaw = async (extra = {}) => {
  const child = spawn(process.execPath, [script], { env: { ...env, ...extra }, stdio: 'ignore' });
  await until(() => existsSync(socket));
  return child;
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

cli('daemon', 'stop');
await until(() => !existsSync(socket));
{
  const daemonClaude = fakeClaude('daemon');
  const hookClaude = fakeClaude('hook');
  const hookConfig = join(homedir(), 'hook-claude-config');
  const daemonConfig = join(homedir(), 'daemon-claude-config');
  const old = await startRaw({
    CLAUDE_CODE_EXECPATH: daemonClaude.path,
    CLAUDE_CONFIG_DIR: daemonConfig,
  });
  const chat = randomUUID();
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = hookConfig;
  const chatFile = transcriptPathFor(project, chat);
  if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = previous;
  mkdirSync(join(chatFile, '..'), { recursive: true });
  writeFileSync(chatFile, readFileSync(transcript, 'utf8'));
  hook(
    'session-end',
    { CLAUDE_CODE_EXECPATH: hookClaude.path, CLAUDE_CONFIG_DIR: hookConfig },
    JSON.stringify({ session_id: chat, hook_event_name: 'SessionEnd', cwd: project }),
    10_000,
  );
  const ran = await until(() => existsSync(hookClaude.seen), 3000);
  report(
    'a hook served by the daemon runs its own CLAUDE_CODE_EXECPATH, not the daemon one',
    ran && !existsSync(daemonClaude.seen),
    existsSync(daemonClaude.seen) ? 'the daemon binary ran' : '',
  );
  report(
    'a hook served by the daemon reads its own CLAUDE_CONFIG_DIR',
    ran && readFileSync(hookClaude.seen, 'utf8') === hookConfig,
    ran ? readFileSync(hookClaude.seen, 'utf8') : 'no chat found',
  );
  old.kill('SIGKILL');
  await until(() => !alive(old.pid));
  rmSync(socket, { force: true });
}

{
  const frozen = await startRaw();
  process.kill(frozen.pid, 'SIGSTOP');
  try {
    const wanted = hook('session-start', { CLAUDE_DB_DAEMON: 'off' }).stdout;
    const started = Date.now();
    const stuck = hook('session-start', {}, payload, 12_000);
    const waited = Date.now() - started;
    report(
      'a stopped daemon costs a hook about the 2 s ack wait, then the hook answers itself',
      stuck.stdout === wanted && waited < 4000,
      `${waited} ms, status ${stuck.status}`,
    );
    const againAt = Date.now();
    const again = hook('session-start', {}, payload, 12_000);
    const againWaited = Date.now() - againAt;
    report(
      'the next hook does not wait on the stopped daemon again',
      again.stdout === wanted && againWaited < 1500,
      `${againWaited} ms`,
    );
    report('the stopped daemon is replaced', await until(() => !alive(frozen.pid)));
  } finally {
    for (const signal of ['SIGCONT', 'SIGKILL']) {
      try {
        process.kill(frozen.pid, signal);
      } catch {}
    }
  }
}
await until(() => existsSync(socket));

cli('daemon', 'stop');
report('stop shuts it down and removes the socket', await until(() => !existsSync(socket)));

const offCli = cli('daemon', 'off');
const config = JSON.parse(readFileSync(join(memory, 'config.json'), 'utf8'));
report('daemon off turns it off in config', offCli.status === 0 && config.daemon.enabled === false);
hook('session-start');
report('with it off no hook starts one', !(await until(() => existsSync(socket), 1500)));
