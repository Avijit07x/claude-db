import '../../lib/require-isolated.mjs';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { report } from '../../lib/isolated.mjs';
import { createContext } from '../../../dist/context.js';
import { loadConfig } from '../../../dist/config/load.js';
import { clearCursor, flushSession, resetCursor } from '../../../dist/capture/flush.js';

mkdirSync(join(homedir(), 'shop'), { recursive: true });
const project = realpathSync(join(homedir(), 'shop'));
const sessionId = randomUUID();
const transcript = join(homedir(), `${sessionId}.jsonl`);
const written = join(homedir(), '.claude-memory', 'cursors', `${sessionId}.written`);

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

const base = loadConfig();
const ctx = await createContext({ embeddings: { ...base.embeddings, provider: 'none' } });
let rows = 0;
const store = ctx.store;
ctx.store = new Proxy(store, {
  get(target, property) {
    const value = target[property];
    if (typeof value !== 'function') return value;
    return (...args) => {
      if (property === 'insertObservations') rows += args[0].length;
      return value.apply(target, args);
    };
  },
});
const flush = async (rebuild = false) => {
  rows = 0;
  await flushSession(ctx, sessionId, project, transcript, rebuild);
  return rows;
};

try {
  save([...first, ...second]);
  const initial = await flush();
  report('a new chat saves every turn', initial === 2, initial);

  const again = await flush();
  report('the re-read last turn is not saved again when unchanged', again === 0, again);

  save([...first, ...turn(2, 'cap the retry delay', 'Retries are capped at 20s.', 'retry.ts')]);
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

  clearCursor(sessionId);
  report('clearing the cursor forgets what was saved', !existsSync(written));
} finally {
  await ctx.close();
}
