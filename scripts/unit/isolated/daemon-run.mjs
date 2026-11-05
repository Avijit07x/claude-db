import '../../lib/require-isolated.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { report } from '../../lib/isolated.mjs';
import { createContext } from '../../../dist/context.js';
import { recoverAfterCompact } from '../../../dist/hooks/compact.js';
import { runDetached, withWorkerEnv } from '../../../dist/hooks/detached.js';

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
const hook = (name, extra = {}) =>
  spawnSync(process.execPath, [join(dist, 'hooks', `${name}.js`)], {
    input: payload,
    env: { ...env, ...extra },
    encoding: 'utf8',
  });
const cli = (...args) =>
  spawnSync(process.execPath, [join(dist, 'cli', 'index.js'), ...args], { env, encoding: 'utf8' });
const until = async (test, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!test() && Date.now() < end) await new Promise((settle) => setTimeout(settle, 50));
  return test();
};

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

const marker = join(homedir(), 'worker-env.txt');
const probe = join(homedir(), 'worker-env.mjs');
writeFileSync(
  probe,
  `import { writeFileSync } from 'node:fs';\n` +
    `writeFileSync(${JSON.stringify(marker)}, process.env.CLAUDE_DB_WORKER_MARK ?? 'none');\n`,
);
withWorkerEnv({ ...process.env, CLAUDE_DB_WORKER_MARK: 'from-hook' }, () =>
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

cli('daemon', 'stop');
report('stop shuts it down and removes the socket', await until(() => !existsSync(socket)));

const offCli = cli('daemon', 'off');
const config = JSON.parse(readFileSync(join(memory, 'config.json'), 'utf8'));
report('daemon off turns it off in config', offCli.status === 0 && config.daemon.enabled === false);
hook('session-start');
report('with it off no hook starts one', !(await until(() => existsSync(socket), 1500)));
