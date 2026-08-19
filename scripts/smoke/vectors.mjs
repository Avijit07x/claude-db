import { randomUUID } from 'node:crypto';

export default async function run(
  { store, search, project, observations, now, sessionId, expected, uri, dir },
  check,
) {
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
}
