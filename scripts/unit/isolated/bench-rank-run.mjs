import '../../lib/require-isolated.mjs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { report } from '../../lib/isolated.mjs';
import { replay, replayablePrompts } from '../../lib/replay.mjs';
import { buildCases } from '../../lib/rank-compare.mjs';
import { searchableText } from '../../lib/rank-lists.mjs';
import { recallQuery } from '../../../dist/hooks/prompt-recall.js';
import { embedObservations } from '../../../dist/capture/index.js';
import { ConfigSchema } from '../../../dist/config/index.js';
import { createContext } from '../../../dist/context.js';

const DAY = 86_400_000;
const FIRST_PROMPT = Date.parse('2024-03-01T12:00:00Z');
const SECOND_PROMPT = FIRST_PROMPT + 3_600_000;
const home = homedir();
const memoryDir = join(home, '.claude-memory');
mkdirSync(join(home, 'shop'), { recursive: true });
const project = realpathSync(join(home, 'shop'));
const slug = project.replace(/[^a-zA-Z0-9]/g, '-');

mkdirSync(memoryDir, { recursive: true });
writeFileSync(
  join(memoryDir, 'config.json'),
  JSON.stringify({ embeddings: { provider: 'builtin' } }),
);

const lines = (entries) => entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
const user = (at, text) => ({
  type: 'user',
  timestamp: new Date(at).toISOString(),
  message: { content: text },
});
const assistant = (at, text) => ({
  type: 'assistant',
  timestamp: new Date(at).toISOString(),
  message: { content: [{ type: 'text', text }] },
});

const transcripts = join(home, '.claude', 'projects', slug);
mkdirSync(transcripts, { recursive: true });
writeFileSync(
  join(transcripts, 'chat-now.jsonl'),
  lines([
    user(FIRST_PROMPT, 'why did we drop polling for the websocket order feed'),
    assistant(FIRST_PROMPT + 1000, 'Looking at the order feed now.'),
    user(SECOND_PROMPT, 'how do we round order totals to cents'),
    assistant(SECOND_PROMPT + 1000, 'Checking the totals code.'),
  ]),
);

const note = (sessionId, title, body, createdAt) => ({
  id: randomUUID(),
  sessionId,
  project,
  kind: 'decision',
  title,
  body,
  files: [],
  tags: [],
  createdAt,
});

const old = note(
  'chat-old',
  'Decision record',
  'We dropped polling for the websocket order feed because polling hammered the API. Rollout notes, owners and the follow up list for the quarter are kept in the team wiki with the other write ups from that sprint.',
  FIRST_PROMPT - 300 * DAY,
);
const fresh = note(
  'chat-fresh',
  'Order feed',
  'order feed order feed order feed websocket',
  FIRST_PROMPT - DAY,
);
const dense = note(
  'chat-dense',
  'Websocket order feed',
  'websocket order feed websocket order feed websocket order feed',
  FIRST_PROMPT - 30 * DAY,
);
const thin = note(
  'chat-thin',
  'Polling polling polling',
  'polling polling polling polling polling polling',
  FIRST_PROMPT - 60 * DAY,
);
const totals = note(
  'chat-totals',
  'Rounded order totals to cents',
  'Order totals round half up to cents before they are stored.',
  FIRST_PROMPT - 20 * DAY,
);
const future = note(
  'chat-later',
  'Dropped polling for the websocket order feed again',
  'A later chat repeated the same decision.',
  FIRST_PROMPT + DAY,
);
const ownChat = note(
  'chat-now',
  'Dropped polling for the websocket order feed in this chat',
  'Same chat, so excluded.',
  FIRST_PROMPT - 1000,
);

const TOPICS = [
  'linter',
  'avatar',
  'cache',
  'invoice',
  'login',
  'theme',
  'search',
  'upload',
  'email',
  'queue',
];
const filler = TOPICS.map((topic) =>
  note(
    `chat-${topic}`,
    `Tuned the ${topic} settings`,
    `The ${topic} module got new defaults.`,
    FIRST_PROMPT - 5 * DAY,
  ),
);

const names = new Map(
  [
    [old, 'old'],
    [fresh, 'fresh'],
    [dense, 'dense'],
    [thin, 'thin'],
    [totals, 'totals'],
    ...filler.map((row, i) => [row, TOPICS[i]]),
  ].map(([row, name]) => [row.id, name]),
);
const named = (lists) =>
  Object.fromEntries(
    Object.entries(lists).map(([list, ids]) => [list, ids.map((id) => names.get(id)).join(',')]),
  );

const defaults = ConfigSchema.parse({});
const ctx = await createContext({ embeddings: { ...defaults.embeddings, provider: 'builtin' } });
const everything = [old, fresh, dense, thin, totals, future, ownChat, ...filler];
const script = new URL('../../bench-inject.mjs', import.meta.url).pathname;
const cli = (...flags) =>
  spawnSync(process.execPath, ['--no-warnings', script, project, '--last', '10', ...flags], {
    env: { ...process.env, CLAUDE_CODE_EXECPATH: join(home, 'no-claude') },
    encoding: 'utf8',
  });

try {
  await embedObservations(ctx, everything);
  await ctx.store.insertObservations(everything);
  const prompts = replayablePrompts(project, 10);
  const { shownBefore } = await replay(ctx, project, prompts);
  const cases = await buildCases(ctx, project, prompts, shownBefore);
  const [first, second] = cases.map((item) => named(item.lists));

  report('two prompts are compared, each with four lists', cases.length === 2);
  report(
    'fused, fused without recency, keyword and keyword by shared words differ as designed',
    JSON.stringify(first) ===
      JSON.stringify({
        fused: 'fresh,dense,thin,old,linter,totals',
        fusedNoRecency: 'dense,fresh,old,thin,totals,linter',
        keyword: 'dense,fresh,old,thin,totals',
        keywordOverlap: 'old,dense,fresh,thin,totals',
      }),
    JSON.stringify(first),
  );
  report(
    'the second prompt is built from the same query',
    second.keyword === 'totals,fresh,dense,old' && second.fused === 'fresh,totals,dense,old',
    JSON.stringify(second),
  );
  report(
    'recency decays from the prompt time, not from now',
    first.fused !== first.fusedNoRecency && first.fused.startsWith('fresh'),
  );
  const { item } = cases[0];
  const scope = { project, sessionId: item.sessionId, until: item.timestamp - 1 };
  const live = await ctx.search.search(recallQuery(searchableText(item.prompt), scope));
  report(
    'the fused list is exactly what production search returns',
    named(cases[0].lists).fused ===
      live
        .filter((entry) => !shownBefore[0].has(entry.id))
        .map((entry) => names.get(entry.id))
        .join(','),
  );
  const listed = new Set(cases.flatMap((item) => item.union));
  report(
    'a later note, a note from the same chat and the facts are left out',
    !listed.has(future.id) && !listed.has(ownChat.id),
  );
  const seen = await buildCases(ctx, project, prompts, [new Set([old.id]), new Set()]);
  report(
    'notes already shown in the chat are dropped from every list',
    seen[0].union.every((id) => id !== old.id) && seen[1].union.includes(old.id),
  );

  const labels = join(home, 'labels.json');
  writeFileSync(labels, JSON.stringify({ 0: [old.id], 1: [totals.id] }));
  const run = cli('--compare-rank', '--labels', labels);
  const row = (name) => run.stdout.split('\n').find((text) => text.trim().startsWith(name)) ?? '';
  const cells = (name) =>
    row(name)
      .trim()
      .split(/\s{2,}/);
  const point = (cell) => cell.split(' ')[0];
  const metrics = (name) => cells(name).slice(1).map(point).join(' ');
  report('the run exits cleanly', run.status === 0, run.stderr.trim().slice(-200));
  report(
    'fused: both prompts hit, precision 1/6, AUC 4/8',
    metrics('fused (today)') === '100% 0.17 0.50',
    row('fused (today)'),
  );
  report(
    'fused without recency: AUC 6/8',
    metrics('fused, no recency') === '100% 0.33 0.75',
    row('fused, no recency'),
  );
  report(
    'keyword only: AUC 5/7',
    metrics('keyword only') === '100% 0.33 0.71',
    row('keyword only'),
  );
  report(
    'keyword by shared words: AUC 7/7',
    metrics('keyword + shared words') === '100% 0.33 1.00',
    row('keyword + shared words'),
  );
  report(
    'the verdict drops vectors and recency',
    /Verdict: vectors REMOVE .*recency DROP/.test(run.stdout),
    run.stdout,
  );
  const bare = cli('--compare-rank');
  report(
    'it refuses to run without a judge or labels',
    bare.status === 1 && bare.stderr.includes('--judge or --labels'),
  );
} finally {
  await ctx.close();
}
