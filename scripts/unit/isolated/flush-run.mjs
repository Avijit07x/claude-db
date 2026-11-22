import '../../lib/require-isolated.mjs';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { report } from '../../lib/isolated.mjs';
import { createContext } from '../../../dist/context.js';
import { loadConfig } from '../../../dist/config/load.js';
import {
  clearCursor,
  flushSession,
  resetCursor,
  sweepCursors,
  sweepCursorsDaily,
} from '../../../dist/capture/flush.js';

mkdirSync(join(homedir(), 'shop'), { recursive: true });
const project = realpathSync(join(homedir(), 'shop'));
const sessionId = randomUUID();
const transcript = join(homedir(), `${sessionId}.jsonl`);
const cursors = join(homedir(), '.claude-memory', 'cursors');

const now = Date.now();
const at = (minutes) => new Date(now - minutes * 60_000).toISOString();
const turn = (minutes, ask, reply, file) => [
  { type: 'user', timestamp: at(minutes), message: { content: ask } },
  {
    type: 'assistant',
    timestamp: at(minutes),
    message: {
      content: [
        { type: 'text', text: reply },
        {
          type: 'tool_use',
          id: randomUUID(),
          name: 'Edit',
          input: { file_path: join(project, file) },
        },
      ],
    },
  },
];
const save = (entries) =>
  writeFileSync(transcript, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');

const first = turn(
  5,
  'make the order feed reconnect',
  'The feed reconnects with backoff.',
  'feed.ts',
);
const second = turn(2, 'cap the retry delay', 'Retries are capped at 30s.', 'retry.ts');
const capped = turn(2, 'cap the retry delay', 'Retries are capped at 20s.', 'retry.ts');
const third = turn(1, 'log the reconnects', 'Reconnects are logged.', 'log.ts');

const base = loadConfig();
const ctx = await createContext({ embeddings: { ...base.embeddings, provider: 'none' } });
let rows = 0;
let embedCalls = 0;
let failSessionWrite = false;
let failRowWrite = false;
ctx.embedder = async () => ({
  id: 'fake',
  dimensions: 2,
  minRelevance: 0,
  embed: async (texts) => ((embedCalls += texts.length), texts.map(() => [1, 0])),
});
const store = ctx.store;
ctx.store = new Proxy(store, {
  get(target, property) {
    const value = target[property];
    if (typeof value !== 'function') return value;
    return (...args) => {
      if (property === 'insertObservations' && failRowWrite) {
        failRowWrite = false;
        return Promise.reject(new Error('row write failed'));
      }
      if (property === 'insertObservations') rows += args[0].length;
      if (property === 'upsertSession' && failSessionWrite) {
        failSessionWrite = false;
        return Promise.reject(new Error('session write failed'));
      }
      return value.apply(target, args);
    };
  },
});
const flush = async (rebuild = false) => {
  rows = 0;
  embedCalls = 0;
  await flushSession(ctx, sessionId, project, transcript, rebuild);
  return rows;
};

try {
  save([...first, ...second]);
  const initial = await flush();
  report('a new chat saves every turn', initial === 2, initial);

  const again = await flush();
  report('the re-read last turn is not saved again when unchanged', again === 0, again);

  save([...first, ...capped]);
  const edited = await flush();
  report('a last turn that changed is saved again', edited === 1, edited);

  resetCursor(sessionId);
  const rebuilt = await flush(true);
  report('a rebuild saves every turn', rebuilt === 2, rebuilt);

  const stored = await store.list({ project, sessionId });
  report(
    'the stored rows match the transcript',
    stored.length === 2 && stored.some((obs) => obs.body.includes('20s')),
    stored.map((obs) => obs.title).join(' | '),
  );

  resetCursor(sessionId);
  const stale = await flush();
  report(
    'a zero cursor saves and embeds nothing when the rows are already stored',
    stale === 0 && embedCalls === 0,
    `${stale} rows, ${embedCalls} embeds`,
  );

  save([...first, ...capped, ...third]);
  const grown = await flush();
  report(
    'only the new turn is saved and embedded',
    grown === 1 && embedCalls === 1,
    `${grown} rows, ${embedCalls} embeds`,
  );

  clearCursor(sessionId);
  rows = 0;
  await Promise.all([
    flushSession(ctx, sessionId, project, transcript),
    flushSession(ctx, sessionId, project, transcript),
  ]);
  const unique = await store.list({ project, sessionId });
  report(
    'two flushes of one chat at once leave exactly the unique rows',
    unique.length === 3,
    unique.length,
  );

  const lock = join(cursors, `${sessionId}.lock`);
  writeFileSync(lock, String(process.pid));
  const prompted = await flushSession(ctx, sessionId, project, transcript);
  report(
    'a flush is never skipped, so the prompt always gets the last reply',
    prompted.skipped === undefined && prompted.lastReply.includes('Reconnects are logged'),
    JSON.stringify(prompted.lastReply),
  );

  for (const name of ['written', 'lock', 'lock.break']) {
    writeFileSync(join(cursors, `${sessionId}.${name}`), '{}');
  }
  sweepCursors();
  report(
    'the sweep removes the old .written and .lock files',
    ['written', 'lock', 'lock.break'].every(
      (name) => !existsSync(join(cursors, `${sessionId}.${name}`)),
    ),
  );

  writeFileSync(join(cursors, 'gone-chat.offset'), '10');
  const swept = sweepCursorsDaily();
  report(
    'the daily sweep removes read positions of chats whose transcript is gone',
    swept >= 1 && !existsSync(join(cursors, 'gone-chat.offset')),
    swept,
  );
  writeFileSync(join(cursors, 'gone-again.offset'), '10');
  report(
    'a second sweep on the same day does nothing',
    sweepCursorsDaily() === 0 && existsSync(join(cursors, 'gone-again.offset')),
  );
  report(
    'the sweep runs again a day later',
    sweepCursorsDaily(Date.now() + 25 * 60 * 60 * 1000) >= 1 &&
      !existsSync(join(cursors, 'gone-again.offset')),
  );

  const halfway = randomUUID();
  const halfwayTranscript = join(homedir(), `${halfway}.jsonl`);
  writeFileSync(
    halfwayTranscript,
    [...first, ...second].map((entry) => JSON.stringify(entry)).join('\n') + '\n',
  );
  failSessionWrite = true;
  const failed = await flushSession(ctx, halfway, project, halfwayTranscript).then(
    () => false,
    () => true,
  );
  report('a flush whose session write fails throws', failed);
  const retried = await flushSession(ctx, halfway, project, halfwayTranscript);
  const session = await store.getSession(halfway);
  report(
    'the retry after a failed session write still saves the chat summary',
    retried.summary !== null && Boolean(session?.summary),
    `${retried.summary} | ${session?.summary}`,
  );

  const keyed = join(homedir(), 'keyed');
  mkdirSync(keyed, { recursive: true });
  const remote = 'https://example.com/acme/keyed.git';
  execFileSync('git', ['init', '-q', keyed]);
  execFileSync('git', ['-C', keyed, 'remote', 'add', 'origin', remote]);
  const keyedId = randomUUID();
  const keyedTranscript = join(homedir(), `${keyedId}.jsonl`);
  writeFileSync(
    keyedTranscript,
    [...first, ...second].map((entry) => JSON.stringify(entry)).join('\n') + '\n',
  );
  await flushSession(ctx, keyedId, realpathSync(keyed), keyedTranscript);
  const keyedAgain = await flushSession(ctx, keyedId, realpathSync(keyed), keyedTranscript);
  const [keyedRow] = await store.list({ sessionId: keyedId });
  report(
    'a chat in a folder stored under its remote key is not saved again',
    keyedAgain.observations === 0 && keyedRow?.project !== realpathSync(keyed),
    `${keyedAgain.observations} rows, stored as ${keyedRow?.project}`,
  );

  const crashed = randomUUID();
  const crashedTranscript = join(homedir(), `${crashed}.jsonl`);
  writeFileSync(
    crashedTranscript,
    [...first, ...second].map((entry) => JSON.stringify(entry)).join('\n') + '\n',
  );
  failRowWrite = true;
  const rowsFailed = await flushSession(ctx, crashed, project, crashedTranscript).then(
    () => false,
    () => true,
  );
  const sessionFirst = await store.getSession(crashed);
  report(
    'a flush whose row write fails throws, after the session was saved',
    rowsFailed && Boolean(sessionFirst?.summary),
  );
  const recovered = await flushSession(ctx, crashed, project, crashedTranscript);
  const savedRows = await store.list({ project, sessionId: crashed });
  report(
    'the retry after a crash after the session write still saves the rows',
    recovered.observations === 2 && savedRows.length === 2,
    `${recovered.observations} saved, ${savedRows.length} stored`,
  );
} finally {
  await ctx.close();
}
