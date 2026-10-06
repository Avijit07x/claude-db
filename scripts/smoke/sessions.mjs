export default async function run({ store, search, project, observations, sessionId }, check) {
  const seeded = new Set(
    observations.filter((obs) => obs.sessionId === sessionId).map((obs) => obs.id),
  );

  const all = await search.search({ text: 'websocket reconnect', project, limit: 5 });
  const excluded = await search.search({
    text: 'websocket reconnect',
    project,
    limit: 5,
    excludeSessions: [sessionId],
  });
  check(
    'search can leave out one chat',
    all.some((hit) => seeded.has(hit.id)) && excluded.every((hit) => !seeded.has(hit.id)),
    `${all.length} -> ${excluded.length}`,
  );

  const unrelated = await search.search({
    text: 'websocket reconnect',
    project,
    limit: 5,
    excludeSessions: ['a-chat-that-wrote-nothing'],
  });
  check(
    'leaving out another chat changes nothing',
    unrelated.map((hit) => hit.id).join() === all.map((hit) => hit.id).join(),
  );

  const listed = await store.list({ project, sessionId, limit: 100 });
  check(
    'list can read back one chat',
    listed.length === seeded.size && listed.every((obs) => obs.sessionId === sessionId),
    `${listed.length} of ${seeded.size}`,
  );
  check(
    'a chat with no rows lists nothing',
    (await store.list({ project, sessionId: 'a-chat-that-wrote-nothing' })).length === 0,
  );

  const stale = {
    id: '5ca1ab1e-0000-4000-8000-000000000001',
    sessionId: 'a-chat-saved-by-older-rules',
    project,
    kind: 'context',
    title: 'Quokka migration notes captured under the old rules',
    body: 'Asked: [Image: source: /tmp/quokka.png]\n\nQuokka migration notes.',
    files: [],
    tags: [],
    createdAt: Date.now(),
  };
  await store.insertObservations([stale]);
  const findQuokka = () => search.search({ text: 'quokka migration notes', project, limit: 5 });
  const before = await findQuokka();

  check('marking a row replaced reports it', (await store.markReplaced([stale.id])) === 1);
  check('marking it again is a no-op', (await store.markReplaced([stale.id])) === 0);
  const after = await findQuokka();
  check(
    'a replaced row drops out of search',
    before.some((hit) => hit.id === stale.id) && !after.some((hit) => hit.id === stale.id),
    `${before.length} -> ${after.length}`,
  );
  const [kept] = await store.getObservations([stale.id]);
  check('but it is still stored, marked replaced', kept?.status === 'replaced');
  check(
    'and the timeline leaves it out',
    !(await search.timeline({ observationId: stale.id, before: 5, after: 5 })).some(
      (entry) => entry.id === stale.id,
    ),
  );
  await store.remove({ ids: [stale.id] });

  const chat = 'smoke-session-times';
  await store.upsertSession({ id: chat, project, startedAt: 1, summary: 'first', updatedAt: 1000 });
  await store.upsertSession({ id: chat, project, startedAt: 1, distilledAt: 2000 });
  const timed = await store.getSession(chat);
  check(
    'a session keeps its summary time and its distilled time across upserts',
    timed?.updatedAt === 1000 && timed?.distilledAt === 2000 && timed?.summary === 'first',
    JSON.stringify(timed),
  );
  await store.clearSummary(chat);
  const cleared = await store.getSession(chat);
  check(
    'clearing a summary records when it happened',
    cleared?.summary === undefined && (cleared?.updatedAt ?? 0) > 1000,
  );
}
