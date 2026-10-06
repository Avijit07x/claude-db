import { randomUUID } from 'node:crypto';

export default async function run({ store, project, now, sessionId, expected }, check) {
  const stamped = {
    id: randomUUID(),
    sessionId,
    project,
    kind: 'context',
    title: 'Stamped row',
    body: 'provenance check',
    files: [],
    tags: [],
    createdAt: now,
    embedding: [1, 0, 0],
    embedder: 'test-model',
    author: 'alex',
  };
  await store.insertObservations([stamped]);
  const [back] = await store.getObservations([stamped.id]);
  check(
    'author and embedder round-trip',
    back.author === 'alex' && back.embedder === 'test-model',
    `${back.author} / ${back.embedder}`,
  );

  const foreign = await store.searchVector([1, 0, 0], {
    text: '',
    project,
    limit: 5,
    embedder: 'other-model',
  });
  check(
    'vector search skips rows from a different embedder',
    !foreign.some((entry) => entry.id === stamped.id),
  );
  const own = await store.searchVector([1, 0, 0], {
    text: '',
    project,
    limit: 5,
    embedder: 'test-model',
  });
  check(
    'vector search keeps rows from the current embedder',
    own.some((entry) => entry.id === stamped.id),
  );

  if (expected !== 'postgres') return;

  const wider = {
    id: randomUUID(),
    sessionId,
    project,
    kind: 'context',
    title: 'Wider row',
    body: 'written while the column is narrower than the embedder',
    files: [],
    tags: [],
    createdAt: now,
    embedding: [1, 0, 0, 0],
    embedder: 'wider-model',
  };
  await store.insertObservations([wider]);
  const [rejected] = await store.getObservations([wider.id]);
  check(
    'a row whose vector was rejected claims no embedder',
    rejected.embedder === undefined && !rejected.embedding,
    `${rejected.embedder} / ${rejected.embedding?.length ?? 0}d`,
  );

  check('postgres exposes migrateVectorDims', typeof store.migrateVectorDims === 'function');
  if (typeof store.migrateVectorDims !== 'function') return;

  check('migrateVectorDims rebuilds at the new width', (await store.migrateVectorDims(4)) === true);
  check(
    'migrateVectorDims is a no-op at the current width',
    (await store.migrateVectorDims(4)) === false,
  );

  const [cleared] = await store.getObservations([stamped.id]);
  check(
    'migration clears embedder so reembed retries every row',
    cleared.embedder === undefined && !cleared.embedding,
    `${cleared.embedder} / ${cleared.embedding?.length ?? 0}d`,
  );

  await store.insertObservations([wider]);
  const [stored] = await store.getObservations([wider.id]);
  check(
    'the wider vector round-trips after migration',
    stored.embedder === 'wider-model' && stored.embedding?.length === 4,
    `${stored.embedder} / ${stored.embedding?.length ?? 0}d`,
  );

  const found = await store.searchVector([1, 0, 0, 0], {
    text: '',
    project,
    limit: 5,
    embedder: 'wider-model',
  });
  check(
    'vector search works again after migration',
    found.some((entry) => entry.id === wider.id),
  );

  await store.migrateVectorDims(3);
}
