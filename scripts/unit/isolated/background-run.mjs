import '../../lib/require-isolated.mjs';
import { existsSync, readFileSync } from 'node:fs';
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
