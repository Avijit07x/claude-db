import '../../lib/require-isolated.mjs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expirePause } from '../../lib/budget-files.mjs';
import { report } from '../../lib/isolated.mjs';
import { pickStatus } from '../../../dist/cli/commands/pick.js';
import { ConfigSchema } from '../../../dist/config/index.js';
import { createContext } from '../../../dist/context.js';
import { embedObservations } from '../../../dist/capture/index.js';
import { finishPick, startPick, takeReady } from '../../../dist/pick/pending.js';
import { budgetUsage } from '../../../dist/util/daily-budget.js';

const dist = new URL('../../../dist/', import.meta.url).pathname;
const home = homedir();
const memoryDir = join(home, '.claude-memory');
mkdirSync(join(home, 'shop'), { recursive: true });
const project = realpathSync(join(home, 'shop'));

const QUOTE =
  'The websocket client sends no heartbeat, so the proxy closes an idle connection after 60 seconds.';
const PREVIOUS_REPLY = 'I changed the retry delay; the feed handler is next.';

const fake = join(home, 'claude');
writeFileSync(
  fake,
  `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const argv = process.argv.slice(2);
appendFileSync(${JSON.stringify(join(home, 'calls.jsonl'))}, JSON.stringify({
  argv,
  thinking: process.env.MAX_THINKING_TOKENS ?? null,
  capture: process.env.CLAUDE_DB_CAPTURE ?? null,
}) + '\\n');
if (process.env.FAKE_MODE === 'fail') {
  process.stderr.write('error: not logged in\\n');
  process.exit(1);
}
const prompt = argv[argv.indexOf('-p') + 1];
const memories = JSON.parse(prompt.slice(prompt.indexOf('<memories>') + 10, prompt.indexOf('</memories>')));
const hit = memories.find((m) => m.memory.includes(${JSON.stringify(QUOTE)}));
process.stdout.write(JSON.stringify({ picks: hit ? [{ id: hit.id, quote: ${JSON.stringify(QUOTE)} }] : [] }));
`,
);
chmodSync(fake, 0o755);

const env = (extra = {}) => {
  const base = { ...process.env, CLAUDE_CODE_EXECPATH: fake, ...extra };
  delete base.CLAUDE_CODE_ENTRYPOINT;
  delete base.CLAUDE_DB_CAPTURE;
  return base;
};

const transcript = (sessionId) => {
  const path = join(home, `${sessionId}.jsonl`);
  const at = new Date(Date.now() - 60_000).toISOString();
  writeFileSync(
    path,
    [
      { type: 'user', timestamp: at, message: { content: 'tighten the banner spacing' } },
      {
        type: 'assistant',
        timestamp: at,
        message: { content: [{ type: 'text', text: PREVIOUS_REPLY }] },
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n') + '\n',
  );
  return path;
};

const hook = (file, payload, extra = {}) =>
  spawnSync(process.execPath, ['--no-warnings', join(dist, 'hooks', file)], {
    input: JSON.stringify(payload),
    env: env(extra),
    encoding: 'utf8',
  });

const prompt = (sessionId, text, extra = {}) =>
  hook(
    'user-prompt.js',
    {
      session_id: sessionId,
      cwd: project,
      prompt: text,
      transcript_path: transcript(sessionId),
      hook_event_name: 'UserPromptSubmit',
    },
    extra,
  );

const deliver = (sessionId) => {
  const out = hook('pick-deliver.js', {
    session_id: sessionId,
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
  }).stdout.trim();
  return out ? JSON.parse(out) : null;
};

const pendingDir = join(memoryDir, 'pick', 'pending');
async function waitForReady(sessionId) {
  for (let i = 0; i < 150; i++) {
    const state = join(pendingDir, `${sessionId}.json`);
    if (existsSync(state)) {
      const { token } = JSON.parse(readFileSync(state, 'utf8'));
      if (existsSync(join(pendingDir, `${sessionId}.${token}.ready.json`))) return true;
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  return false;
}

const calls = () =>
  existsSync(join(home, 'calls.jsonl'))
    ? readFileSync(join(home, 'calls.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];

const writeConfig = (value) => {
  mkdirSync(memoryDir, { recursive: true });
  writeFileSync(join(memoryDir, 'config.json'), JSON.stringify(value));
};

const ctx = await createContext();
const row = (title, body) => ({
  id: randomUUID(),
  sessionId: 'earlier-chat',
  project,
  kind: 'decision',
  title,
  body,
  files: [],
  tags: [],
  createdAt: Date.now() - 86_400_000,
  status: 'done',
});
const tiles = row(
  'Order feed needs a heartbeat',
  `Asked: why does the order feed drop after a minute?\n\n${QUOTE}`,
);
const rows = [
  tiles,
  row(
    'Retries capped at five',
    'Asked: how many retries?\n\nRetries are capped at five attempts per request.',
  ),
  row(
    'Totals round half up',
    'Asked: how are totals rounded?\n\nOrder totals round half up to whole cents.',
  ),
];
await embedObservations(ctx, rows);
await ctx.store.insertObservations(rows);
await ctx.close();

const live = randomUUID();
const started = prompt(live, 'the order feed keeps dropping and I do not know why');
report(
  'the prompt is not held up: nothing is added at prompt time',
  started.stdout.trim() === '',
  started.stdout + started.stderr,
);
report('the background pick finishes', await waitForReady(live));

const [call] = calls();
const sent = call?.argv[call.argv.indexOf('-p') + 1] ?? '';
report('Haiku runs with thinking off', call?.thinking === '0', JSON.stringify(call));
report(
  'Haiku runs with a short system prompt, no tools and no MCP servers',
  call?.argv.includes('--system-prompt') &&
    call.argv[call.argv.indexOf('--tools') + 1] === '' &&
    call.argv.includes('--strict-mcp-config'),
  call?.argv.filter((arg) => arg.startsWith('--')).join(' '),
);
report('the pick never records itself as memory', call?.capture === 'off');
report('Haiku sees the end of the previous reply', sent.includes(PREVIOUS_REPLY));
report('the pick counts against the daily limit', budgetUsage('pick').used === 1);

const delivered = deliver(live);
const context = delivered?.hookSpecificOutput?.additionalContext ?? '';
report(
  'the first tool call carries the pick',
  delivered?.hookSpecificOutput?.hookEventName === 'PreToolUse' &&
    context.includes(`asked "why does the order feed drop after a minute?": ${QUOTE}`) &&
    context.includes('(context ≈'),
  context,
);
report('the pick is delivered only once', deliver(live) === null);
const shownFile = join(memoryDir, 'cursors', `${live}.shown`);
report(
  'a delivered memory counts as shown in this chat',
  existsSync(shownFile) && readFileSync(shownFile, 'utf8').includes(tiles.id),
);

const secret = randomUUID();
prompt(secret, 'order feed drops after a minute, my key is sk-ant-api03-abcdefghijklmnopqrstuvwx');
await waitForReady(secret);
const leaked = calls().at(-1);
report(
  'a key typed in the prompt never reaches Haiku',
  leaked && !JSON.stringify(leaked.argv).includes('abcdefghijklmnopqrstuvwx'),
  JSON.stringify(leaked?.argv ?? []).slice(0, 120),
);

const stale = randomUUID();
const job = { project, prompt: 'p', previousReply: '', ids: [], fallback: null };
const first = startPick(stale, job);
startPick(stale, job);
report(
  'a pick for an earlier prompt is never delivered',
  finishPick(stale, first, { text: 'old', ids: [] }) === false && takeReady(stale) === null,
);
const fresh = startPick(stale, job, Date.now() - 11 * 60_000);
finishPick(stale, fresh, { text: 'late', ids: [] }, Date.now() - 11 * 60_000);
report('a pick older than ten minutes is dropped', takeReady(stale) === null);

const failing = randomUUID();
prompt(failing, 'why does the order feed drop after a minute', { FAKE_MODE: 'fail' });
report('a failed pick still finishes', await waitForReady(failing));
const fallback = deliver(failing)?.hookSpecificOutput?.additionalContext ?? '';
report(
  'when Haiku fails, a strong word match is shown instead',
  fallback.includes('Order feed needs a heartbeat') && !fallback.includes('asked "'),
  fallback,
);
const failure = budgetUsage('pick');
report(
  'after a failure, picking pauses for an hour',
  failure.failures === 1 && Math.abs(failure.pausedUntil - Date.now() - 3_600_000) < 60_000,
  JSON.stringify(failure),
);
report(
  'the reason is kept and status shows it',
  pickStatus(ConfigSchema.parse({})).includes(
    'after a failed call: exited with code 1: error: not logged in',
  ),
  pickStatus(ConfigSchema.parse({})),
);
const paused = prompt(randomUUID(), 'why does the order feed drop after a minute');
report(
  'while paused, the strong match is shown at once without calling Haiku',
  paused.stdout.includes('Order feed needs a heartbeat') && calls().length === 3,
  `${paused.stdout} calls=${calls().length}`,
);

writeConfig({ pick: { enabled: false } });
const off = prompt(randomUUID(), 'why does the order feed drop after a minute');
report(
  'with pick off, Claude is never called and the strong match shows at once',
  off.stdout.includes('Order feed needs a heartbeat') && calls().length === 3,
  off.stdout,
);
const weak = prompt(randomUUID(), 'the order feed looks fine now');
report('with pick off, a weak match shows nothing', weak.stdout.trim() === '', weak.stdout);

writeConfig({});
expirePause('pick');
const recovering = randomUUID();
prompt(recovering, 'why does the order feed drop after a minute');
await waitForReady(recovering);
const recovered = budgetUsage('pick');
report(
  'a working pick after a failure clears the streak and the reason',
  recovered.failures === 0 && recovered.lastFailure === null,
  JSON.stringify(recovered),
);
