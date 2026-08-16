// End-to-end check against a throwaway SQLite file: write observations,
// then confirm each of the three disclosure layers returns sane results.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore } from '../dist/store/index.js';
import { SearchService } from '../dist/search/index.js';
import { NoopEmbedder } from '../dist/embed/index.js';
import { remember } from '../dist/capture/index.js';

// Pass a connection string to run the identical checks against Postgres or
// MongoDB; with no argument it uses a throwaway SQLite file.
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

// Without this the index gives a reader nothing to choose on, so they expand
// at random and pay a whole body per guess. FTS5 and ts_headline centre the
// fragment on the match; Mongo's $text cannot, and returns the head of the body.
const withSnippet = hits.filter((h) => h.snippet);
check('keyword hits carry a snippet', withSnippet.length > 0,
  `${withSnippet.length}/${hits.length}`);
check('a snippet is one line and bounded',
  withSnippet.every((h) => !h.snippet.includes('\n') && h.snippet.length <= 120),
  withSnippet[0]?.snippet);
check('a snippet shows body text the title does not',
  withSnippet.some((h) => !h.title.includes(h.snippet.replace(/…/g, '').trim().slice(0, 20))),
  withSnippet[0]?.snippet);

// Tags carry the repository or top-level directory an observation touched, so
// they have to be searchable on every backend. "performance" is in tags only,
// in no title and no body.
const byTag = await search.search({ text: 'performance', project, limit: 5 });
check('tags are searchable, not just titles and bodies', byTag.length === 2,
  `${byTag.length} hits`);

// Ranking on a tag is not the same as filtering by one. A workspace pooling
// several repositories under one project could not ask for just one of them.
const scoped = await search.search({ text: 'websocket', project, tag: 'auth', limit: 5 });
check('tag filter narrows to one area',
  scoped.length === 1 && scoped[0].title.includes('reconnect storm'),
  scoped.map((h) => h.title).join(' | '));
check('tag filter matches whole tags, not prefixes',
  (await search.search({ text: 'websocket', project, tag: 'real', limit: 5 })).length === 0);

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

// re-ingest: the flush cursor re-reads the open turn on every prompt, so the
// same id is written repeatedly as its content grows.
const revised = {
  id: randomUUID(), sessionId, project, kind: 'context',
  files: [], tags: [], createdAt: now,
};
await store.insertObservations([
  { ...revised, title: 'Zerplix cache warmer drafted', body: 'first pass' },
]);
await store.insertObservations([
  { ...revised, title: 'Quorbit cache warmer finished', body: 'second pass' },
]);

if (expected === 'sqlite') {
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(uri);
  const orphans = raw
    .prepare(`SELECT count(*) AS n FROM observations_fts WHERE observations_fts MATCH '"zerplix"'`)
    .get().n;
  raw.close();
  check('re-ingest leaves no orphan rows in the fts index', orphans === 0,
    `${orphans} orphan posting(s)`);
}

// `use` reads this before init() creates our tables, so it can say "this
// database already holds 14 other collections" instead of quietly adding two
// to somebody's production database, which is what it did.
check('inventory reports none of our own tables',
  (await store.inventory()).every((name) => !/^(sessions|observations)/.test(name)),
  (await store.inventory()).join(','));

if (expected === 'sqlite') {
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(uri);
  raw.exec('CREATE TABLE IF NOT EXISTS orders (id TEXT)');
  raw.close();
  check('inventory reports a table that is not ours',
    (await store.inventory()).includes('orders'), (await store.inventory()).join(','));
}

const current = await search.search({ text: 'quorbit', project, limit: 5 });
check('re-ingest keeps the newest version searchable',
  current.length === 1 && current[0].title.includes('Quorbit'),
  current.map((h) => h.title).join(' | '));

const reread = await store.getObservations([revised.id]);
check('re-ingest updates in place rather than duplicating',
  reread.length === 1 && reread[0].body === 'second pass', reread[0]?.body);

// --- remember, forget, prune, list ------------------------------------------
const ctx = { store, embedder: async () => new NoopEmbedder() };

const noted = await remember(ctx, {
  project,
  text: 'Always use pnpm in this repo\nnpm lockfiles cause needless churn',
});
check('remember records a standing rule', noted.kind === 'preference', noted.kind);

// Dictated memory goes through the same redaction as captured memory; it used
// to be stored raw, on the path most likely to carry a credential.
const dictated = await remember(ctx, {
  project,
  text: 'The staging database is postgres://admin:hunter2secret@db.internal:5432/app',
});
check('remember redacts credentials it is handed',
  !dictated.body.includes('hunter2secret') && !dictated.title.includes('hunter2secret'),
  dictated.title);
await store.remove({ ids: [dictated.id] });
check('remember titles from the first line',
  noted.title === 'Always use pnpm in this repo', noted.title);
const recalled = await search.search({ text: 'pnpm lockfiles churn', project, limit: 5 });
check('a remembered note is searchable like any other',
  recalled.some((hit) => hit.id === noted.id), `${recalled.length} hits`);

// A survey of the codebase has to be re-runnable as the codebase changes, so
// the second run must edit the note rather than leave a stale copy beside it.
const profile = { project, kind: 'context', key: 'profile:stack', tags: ['inferred'] };
const first = await remember(ctx, { ...profile, text: 'Node 22 and SQLite' });
const second = await remember(ctx, { ...profile, text: 'Node 22, SQLite and pgvector' });
check('a keyed note keeps one identity across runs', first.id === second.id,
  `${first.id} vs ${second.id}`);
const [stored] = await store.getObservations([first.id]);
check('re-remembering a key replaces what was there',
  stored.body.includes('pgvector') && !stored.body.includes('and SQLite\n'), stored.body);
// Everything else in here is a record of something that happened; a generated
// profile is a reading of the code, and a search result must not blur the two.
check('an inferred note is tagged as inferred', stored.tags.includes('inferred'),
  stored.tags.join(','));
await store.remove({ ids: [first.id] });

// The guard that matters most here: forget with nothing resolvable must not
// be read as "no filter", which is how reset asks to delete everything.
check('an empty id list deletes nothing', (await store.remove({ ids: [] })) === 0);

const forgotten = await store.remove({ ids: [noted.id.slice(0, 13)] });
check('forget deletes by the short id search returns', forgotten === 1, String(forgotten));
check('the forgotten observation is gone',
  (await store.getObservations([noted.id])).length === 0);

const stamped = {
  id: randomUUID(), sessionId, project, kind: 'context',
  title: 'Stamped row', body: 'provenance check', files: [], tags: [],
  createdAt: now, embedding: [1, 0, 0], embedder: 'test-model', author: 'alex',
};
await store.insertObservations([stamped]);
const [back] = await store.getObservations([stamped.id]);
check('author and embedder round-trip', back.author === 'alex' && back.embedder === 'test-model',
  `${back.author} / ${back.embedder}`);

const foreign = await store.searchVector([1, 0, 0], { text: '', project, limit: 5, embedder: 'other-model' });
check('vector search skips rows from a different embedder',
  !foreign.some((entry) => entry.id === stamped.id));
const own = await store.searchVector([1, 0, 0], { text: '', project, limit: 5, embedder: 'test-model' });
check('vector search keeps rows from the current embedder',
  own.some((entry) => entry.id === stamped.id));

const ancient = {
  id: randomUUID(), sessionId, project, kind: 'context',
  title: 'Ancient scaffolding', body: 'x', files: [], tags: [],
  createdAt: now - 400 * 86_400_000,
};
await store.insertObservations([ancient]);
const before = await store.list({ project, limit: 100 });
const pruned = await store.remove({ project, before: now - 200 * 86_400_000 });
check('prune deletes only what is past the cutoff', pruned === 1, String(pruned));
check('prune leaves everything newer alone',
  (await store.list({ project, limit: 100 })).length === before.length - 1);

const page = await store.list({ project, limit: 2 });
check('list pages oldest first',
  page.length === 2 && page[0].createdAt <= page[1].createdAt);
const nextPage = await store.list({ project, after: page[1].createdAt, limit: 2 });
check('list pages forward from a cursor',
  nextPage.every((obs) => obs.createdAt > page[1].createdAt));

// sessions
const recent = await store.recentSessions(project, 5);
check('session summary round-trips', recent.length === 1 && !!recent[0].summary);
check('forgetting and pruning left the session record alone', recent.length === 1);

await store.remove({ project });
await store.close();
rmSync(dir, { recursive: true, force: true });

console.log(failures === 0 ? `\nAll smoke checks passed on ${expected}.` : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
