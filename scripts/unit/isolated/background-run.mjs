import '../../lib/require-isolated.mjs';
import { report } from '../../lib/isolated.mjs';
import { NoopEmbedder } from '../../../dist/embed/index.js';
import {
  claimReembed,
  embedObservations,
  finishReembed,
  startReembed,
  vectorsMissing,
} from '../../../dist/capture/index.js';

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
