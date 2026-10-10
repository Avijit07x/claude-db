import '../../lib/require-isolated.mjs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createContext } from '../../../dist/context.js';
import { report } from '../../lib/isolated.mjs';
import { NoopEmbedder } from '../../../dist/embed/index.js';
import {
  claimReembed,
  embedObservations,
  finishReembed,
  startReembed,
  vectorsMissing,
} from '../../../dist/capture/index.js';
import { CLI, backgroundLog, runDetached } from '../../../dist/hooks/detached.js';

const HOUR = 60 * 60 * 1000;
const project = '/work/shop';
const quiet = '/work/quiet';

const contextWith = (provider) => ({
  config: { embeddings: { provider, batchSize: 8 } },
  embedder: async () => new NoopEmbedder(),
});
const row = (owner) => ({ id: `${owner}-1`, project: owner, title: 't', body: 'b' });

await embedObservations(contextWith('auto'), [row(project)]);
report('a write that ran out of time to embed is noted', vectorsMissing(project));

const wide = '/work/wide';
await embedObservations(
  {
    config: { embeddings: { provider: 'auto', batchSize: 8 } },
    embedder: async () => ({
      id: 'small',
      dimensions: 2,
      minRelevance: 0,
      embed: async (texts) => texts.map(() => [1, 0]),
    }),
    store: { storedVectorDims: () => 384 },
  },
  [row(wide)],
);
report('vectors the database is too wide to store are noted', vectorsMissing(wide));

await embedObservations(contextWith('none'), [row(quiet)]);
report('embeddings turned off note nothing', !vectorsMissing(quiet));

const now = Date.now();
report('a noted project gets a re-embed', claimReembed(project, now));
report('only one re-embed runs at a time', !claimReembed(project, now));

startReembed(project);
report('a started re-embed clears the note', !vectorsMissing(project));
finishReembed(project, now);

await embedObservations(contextWith('auto'), [row(project)]);
report('a new gap soon after a re-embed waits', !claimReembed(project, now + HOUR));
report('the same gap is picked up later', claimReembed(project, now + 7 * HOUR));

runDetached(CLI, ['no-such-command'], process.cwd(), () => {});
const deadline = Date.now() + 10_000;
const logged = () => existsSync(backgroundLog()) && readFileSync(backgroundLog(), 'utf8');
while (!String(logged()).includes('Connection strings') && Date.now() < deadline) {
  await new Promise((settle) => setTimeout(settle, 50));
}
const log = String(logged());
report(
  'a background job is named in the log',
  log.includes('no-such-command started'),
  log.slice(0, 80),
);
report('what a background job prints is kept, not thrown away', log.includes('Connection strings'));

const shop = join(homedir(), 'reembed-shop');
mkdirSync(shop, { recursive: true });
const folder = realpathSync(shop);
mkdirSync(join(homedir(), '.claude-memory'), { recursive: true });
writeFileSync(
  join(homedir(), '.claude-memory', 'config.json'),
  JSON.stringify({ embeddings: { provider: 'builtin' }, updates: 'off' }),
);
const saved = (title, extra) => ({
  id: randomUUID(),
  sessionId: 'reembed-chat',
  project: folder,
  kind: 'pattern',
  title,
  body: title,
  files: [],
  tags: [],
  createdAt: Date.now(),
  status: 'done',
  ...extra,
});
const other = saved('Embedded by another machine', {
  embedding: [0.6, 0.8],
  embedder: 'another-model',
});
const bare = saved('Saved before the model loaded', {});
const before = await createContext();
await before.store.insertObservations([other, bare]);
await before.close();

spawnSync(process.execPath, ['--no-warnings', CLI, 'reembed', '--project', '--background'], {
  cwd: folder,
  encoding: 'utf8',
});
const after = await createContext();
const [kept, filled] = await after.store
  .getObservations([other.id, bare.id])
  .then((rows) => [
    rows.find((obs) => obs.id === other.id),
    rows.find((obs) => obs.id === bare.id),
  ]);
await after.close();
report(
  'a row with a vector from another embedder is unchanged after a background re-embed',
  kept?.embedder === 'another-model' &&
    kept?.embedding?.length === 2 &&
    Math.abs(kept.embedding[0] - 0.6) < 1e-6 &&
    Math.abs(kept.embedding[1] - 0.8) < 1e-6,
  JSON.stringify({ embedder: kept?.embedder, embedding: kept?.embedding?.slice(0, 3) }),
);
report(
  'and a row with no vector is filled',
  (filled?.embedding?.length ?? 0) > 0,
  String(filled?.embedder),
);
