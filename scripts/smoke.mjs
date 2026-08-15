// End-to-end check against a throwaway SQLite file: write observations,
// then confirm each of the three disclosure layers returns sane results.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore } from '../dist/store/index.js';
import { SearchService } from '../dist/search/index.js';
import { NoopEmbedder } from '../dist/embed/index.js';

const dir = mkdtempSync(join(tmpdir(), 'recall-smoke-'));
const dbPath = join(dir, 'memory.db');
const project = '/tmp/demo-project';
let failures = 0;

function check(label, condition, detail = '') {
  const status = condition ? 'PASS' : 'FAIL';
  if (!condition) failures += 1;
  console.log(`${status}  ${label}${detail ? `  (${detail})` : ''}`);
}

const store = await createStore(dbPath);
await store.init();

check('adapter resolved from bare path', store.kind === 'sqlite', store.kind);
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
  ['decision', 'Chose WebSocket over polling for live order updates',
   'Polling at 3s hammered the API and still lagged. Switched to a WebSocket subscription with exponential backoff reconnect.',
   ['src/ws/client.ts'], ['websocket', 'realtime']],
  ['deadend', 'Redux middleware for socket events did not scale',
   'Routing every socket frame through Redux caused re-renders across the whole tree. Moved to React Query cache updates instead.',
   ['src/store/socketMiddleware.ts'], ['redux', 'performance']],
  ['bugfix', 'Fixed reconnect storm on token refresh',
   'Auth refresh triggered a socket teardown that raced the retry timer, opening dozens of sockets. Added a single-flight guard.',
   ['src/ws/reconnect.ts'], ['auth', 'websocket']],
  ['pattern', 'Virtualized the order table with react-window',
   'Rendering 5k rows blocked the main thread. react-window with a fixed row height dropped scripting time to under 8ms.',
   ['src/components/OrderTable.tsx'], ['performance', 'react']],
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

// Layer 1
const hits = await search.search({ text: 'websocket reconnect', project, limit: 5 });
check('layer 1 returns hits', hits.length > 0, `${hits.length} hits`);
check('layer 1 omits bodies', hits.every((h) => !('body' in h)));
const topics = hits.map((h) => h.title.toLowerCase());
check('layer 1 surfaces both websocket records',
  topics.some((t) => t.includes('websocket')) && topics.some((t) => t.includes('reconnect')),
  topics.join(' | '));
check('layer 1 excludes unrelated records',
  !topics.some((t) => t.includes('virtualized')));

// filters
const onlyDeadends = await search.search({ text: 'redux', project, kind: 'deadend', limit: 5 });
check('kind filter works',
  onlyDeadends.length === 1 && onlyDeadends[0].kind === 'deadend');

const otherProject = await search.search({ text: 'websocket', project: '/tmp/nope', limit: 5 });
check('project scoping isolates memory', otherProject.length === 0);

// Layer 2
const tl = await search.timeline({ observationId: observations[2].id, before: 2, after: 2 });
check('layer 2 returns neighbours', tl.length >= 3, `${tl.length} entries`);
check('layer 2 is chronological',
  tl.every((e, i) => i === 0 || tl[i - 1].createdAt <= e.createdAt));

// Layer 3
const full = await search.getObservations([observations[0].id, observations[1].id]);
check('layer 3 batches ids', full.length === 2);
check('layer 3 returns bodies', full.every((o) => o.body.length > 0));

// token shape: the whole point of the 3 layers
const indexChars = hits.map((h) => `${h.id} [${h.kind}] ${h.title}`).join('\n').length;
const fullChars = (await search.getObservations(hits.map((h) => h.id)))
  .map((o) => o.body).join('\n').length;
check('index is materially cheaper than bodies', indexChars < fullChars,
  `${indexChars} vs ${fullChars} chars`);

// sessions
const recent = await store.recentSessions(project, 5);
check('session summary round-trips', recent.length === 1 && !!recent[0].summary);

await store.close();
rmSync(dir, { recursive: true, force: true });

console.log(failures === 0 ? '\nAll smoke checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
