import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore } from '../dist/store/index.js';
import { SearchService } from '../dist/search/index.js';
import { NoopEmbedder } from '../dist/embed/index.js';
import { remember } from '../dist/capture/index.js';

const dir = mkdtempSync(join(tmpdir(), 'recall-smoke-'));
const uri = process.argv[2] ?? join(dir, 'memory.db');
const expected = /^mongodb/.test(uri) ? 'mongodb' : /^postgres/.test(uri) ? 'postgres' : 'sqlite';
const project = '/tmp/demo-project';
let failures = 0;

function check(label, condition, detail = '') {
  const status = condition ? 'PASS' : 'FAIL';
  if (!condition) failures += 1;
  console.log(`${status}  ${label}${detail ? `  (${detail})` : ''}`);
}

const store = await createStore(uri);
await store.init();
await store.remove({ project });

check('adapter resolved from the connection string', store.kind === expected, store.kind);
check('ping', await store.ping());

const now = Date.now();
const sessionId = randomUUID();

await store.upsertSession({
  id: sessionId,
  project,
  startedAt: now - 60_000,
  endedAt: now,
  summary: 'Replaced the polling loop with a WebSocket subscription.',
});

const seed = [
  [
    'decision',
    'Chose WebSocket over polling for live order updates',
    'Polling at 3s hammered the API and still lagged. Switched to a WebSocket subscription with exponential backoff reconnect.',
    ['src/ws/client.ts'],
    ['websocket', 'realtime'],
  ],
  [
    'deadend',
    'Redux middleware for socket events did not scale',
    'Routing every socket frame through Redux caused re-renders across the whole tree. Moved to React Query cache updates instead.',
    ['src/store/socketMiddleware.ts'],
    ['redux', 'performance'],
  ],
  [
    'bugfix',
    'Fixed reconnect storm on token refresh',
    'Auth refresh triggered a socket teardown that raced the retry timer, opening dozens of sockets. Added a single-flight guard.',
    ['src/ws/reconnect.ts'],
    ['auth', 'websocket'],
  ],
  [
    'pattern',
    'Virtualized the order table with react-window',
    'Rendering 5k rows blocked the main thread. react-window with a fixed row height dropped scripting time to under 8ms.',
    ['src/components/OrderTable.tsx'],
    ['performance', 'react'],
  ],
];

const observations = seed.map(([kind, title, body, files, tags], i) => ({
  id: randomUUID(),
  sessionId,
  project,
  kind,
  title,
  body,
  files,
  tags,
  createdAt: now - (seed.length - i) * 10_000,
}));

await store.insertObservations(observations);

const search = new SearchService(store, new NoopEmbedder());

const ctx = { store, search, project, observations, now, sessionId, expected, uri, dir };

import retrieval from './smoke/retrieval.mjs';
import reingest from './smoke/reingest.mjs';
import manual from './smoke/manual.mjs';
import vectors from './smoke/vectors.mjs';
import lifecycle from './smoke/lifecycle.mjs';
import graph from './smoke/graph.mjs';

await retrieval(ctx, check);
await reingest(ctx, check);
await manual(ctx, check);
await vectors(ctx, check);
await lifecycle(ctx, check);
await graph(ctx, check);

await store.remove({ project });
await store.close();
rmSync(dir, { recursive: true, force: true });

console.log(
  failures === 0 ? `\nAll smoke checks passed on ${expected}.` : `\n${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
