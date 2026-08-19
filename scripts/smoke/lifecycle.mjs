import { randomUUID } from 'node:crypto';

export default async function run(
  { store, search, project, observations, now, sessionId, expected, uri, dir },
  check,
) {
  const ancient = {
    id: randomUUID(),
    sessionId,
    project,
    kind: 'context',
    title: 'Ancient scaffolding',
    body: 'x',
    files: [],
    tags: [],
    createdAt: now - 400 * 86_400_000,
  };
  await store.insertObservations([ancient]);
  const before = await store.list({ project, limit: 100 });
  const pruned = await store.remove({ project, before: now - 200 * 86_400_000 });
  check('prune deletes only what is past the cutoff', pruned === 1, String(pruned));
  check(
    'prune leaves everything newer alone',
    (await store.list({ project, limit: 100 })).length === before.length - 1,
  );

  const page = await store.list({ project, limit: 2 });
  check('list pages oldest first', page.length === 2 && page[0].createdAt <= page[1].createdAt);
  const nextPage = await store.list({ project, after: page[1].createdAt, limit: 2 });
  check(
    'list pages forward from a cursor',
    nextPage.every((obs) => obs.createdAt > page[1].createdAt),
  );

  const recent = await store.recentSessions(project, 5);
  check('session summary round-trips', recent.length === 1 && !!recent[0].summary);
  check('forgetting and pruning left the session record alone', recent.length === 1);
  {
    const openObs = {
      id: 'status-open',
      sessionId,
      project,
      kind: 'decision',
      title: 'left open',
      body: 'left open',
      files: ['/tmp/demo-project/src/x.ts'],
      tags: [],
      createdAt: now,
      status: 'open',
    };
    await store.insertObservations([openObs]);
    const [back] = await store.getObservations(['status-open']);
    check('status round-trips on this adapter', back?.status === 'open', back?.status);

    const openOnly = await store.list({ project, status: 'open', limit: 50 });
    check('status filters the list', openOnly.length === 1 && openOnly[0].id === 'status-open');

    const closed = await store.closeObservations(['status-open']);
    check('closing reports how many moved', closed === 1, closed);
    check(
      'a closed row no longer lists as open',
      (await store.list({ project, status: 'open', limit: 50 })).length === 0,
    );
    check('closing again is a no-op', (await store.closeObservations(['status-open'])) === 0);
  }
}
