import { remember } from '../../dist/capture/index.js';
import { NoopEmbedder } from '../../dist/embed/index.js';

export default async function run(
  { store, search, project, observations, now, sessionId, expected, uri, dir },
  check,
) {
  const ctx = { store, embedder: async () => new NoopEmbedder() };

  const noted = await remember(ctx, {
    project,
    text: 'Always use pnpm in this repo\nnpm lockfiles cause needless churn',
  });
  check('remember records a standing rule', noted.kind === 'preference', noted.kind);

  const dictated = await remember(ctx, {
    project,
    text: 'The staging database is postgres://admin:hunter2secret@db.internal:5432/app',
  });
  check(
    'remember redacts credentials it is handed',
    !dictated.body.includes('hunter2secret') && !dictated.title.includes('hunter2secret'),
    dictated.title,
  );
  await store.remove({ ids: [dictated.id] });
  check(
    'remember titles from the first line',
    noted.title === 'Always use pnpm in this repo',
    noted.title,
  );
  const recalled = await search.search({ text: 'pnpm lockfiles churn', project, limit: 5 });
  check(
    'a remembered note is searchable like any other',
    recalled.some((hit) => hit.id === noted.id),
    `${recalled.length} hits`,
  );

  const profile = { project, kind: 'context', key: 'profile:stack', tags: ['inferred'] };
  const first = await remember(ctx, { ...profile, text: 'Node 22 and SQLite' });
  const second = await remember(ctx, { ...profile, text: 'Node 22, SQLite and pgvector' });
  check(
    'a keyed note keeps one identity across runs',
    first.id === second.id,
    `${first.id} vs ${second.id}`,
  );
  const [stored] = await store.getObservations([first.id]);
  check(
    're-remembering a key replaces what was there',
    stored.body.includes('pgvector') && !stored.body.includes('and SQLite\n'),
    stored.body,
  );
  check(
    'an inferred note is tagged as inferred',
    stored.tags.includes('inferred'),
    stored.tags.join(','),
  );
  await store.remove({ ids: [first.id] });

  check('an empty id list deletes nothing', (await store.remove({ ids: [] })) === 0);

  const forgotten = await store.remove({ ids: [noted.id.slice(0, 13)] });
  check('forget deletes by the short id search returns', forgotten === 1, String(forgotten));
  check(
    'the forgotten observation is gone',
    (await store.getObservations([noted.id])).length === 0,
  );
}
