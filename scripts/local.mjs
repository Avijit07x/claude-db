// Proves the zero-config local path: no CLAUDE_DB_URL, no config.json,
// no optional dependencies, no network.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore } from '../dist/store/index.js';
import { SearchService } from '../dist/search/index.js';
import { createEmbedder, BuiltinEmbedder } from '../dist/embed/index.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

// --- embedder resolves with nothing installed --------------------------------
const embedder = await createEmbedder('auto');
check('auto provider yields a working embedder', embedder.dimensions > 0, embedder.id);
const [probe] = await embedder.embed(['hello world']);
check('auto embedder produces vectors', probe.length === embedder.dimensions);

const unit = Math.sqrt(probe.reduce((s, v) => s + v * v, 0));
check('vectors are unit length', Math.abs(unit - 1) < 1e-6, unit.toFixed(6));

// --- builtin captures morphology that exact-token search misses ---------------
const b = new BuiltinEmbedder();
const cos = (x, y) => x.reduce((s, v, i) => s + v * y[i], 0);
const [reconnect, reconnecting, unrelated] = await b.embed([
  'reconnect socket', 'reconnecting sockets', 'invoice pdf export',
]);
const near = cos(reconnect, reconnecting);
const far = cos(reconnect, unrelated);
check('morphological variants score close', near > far * 3, `${near.toFixed(3)} vs ${far.toFixed(3)}`);

// --- end to end, default sqlite, no url --------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'recall-local-'));
const store = await createStore(join(dir, 'memory.db'));
await store.init();

const project = '/tmp/local-app';
const now = Date.now();
const rows = [
  ['bugfix', 'Fixed reconnecting websocket storm', 'Auth refresh raced the retry timer.'],
  ['pattern', 'Virtualized invoice table', 'react-window for 5k rows.'],
];
const observations = [];
for (const [kind, title, body] of rows) {
  const [embedding] = await embedder.embed([`${title}\n${body}`]);
  observations.push({
    id: randomUUID(), sessionId: 's', project, kind, title, body,
    files: [], tags: [], createdAt: now, embedding,
  });
}
await store.insertObservations(observations);

const search = new SearchService(store, embedder);

// "reconnect" is not a literal token in any stored title ("reconnecting" is).
const hits = await search.search({ text: 'reconnect', project, limit: 5 });
check('vector recall finds a non-exact token match', hits.length > 0, `${hits.length} hits`);
check('correct record ranks first', hits[0]?.title.includes('reconnecting'), hits[0]?.title);

const stored = await store.getObservations([observations[0].id]);
check('embeddings round-trip through sqlite',
  stored[0].embedding?.length === embedder.dimensions, String(stored[0].embedding?.length));

await store.close();
rmSync(dir, { recursive: true, force: true });

console.log(failures === 0 ? '\nLocal-only path fully working.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
