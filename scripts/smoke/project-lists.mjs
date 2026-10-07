import { randomUUID } from 'node:crypto';

const ids = (rows) => rows.map((row) => row.id).sort();
const sameIds = (rows, expected) => ids(rows).join() === [...expected].sort().join();

export default async function run({ store }, check) {
  const tag = randomUUID().replace(/\D/g, '').slice(0, 8);
  const term = `kestrel${tag}`;
  const A = `/work/${tag}/a`;
  const B = `/odd/${tag}/it's "b"; DROP TABLE observations;--`;
  const C = `/données/${tag}/日本語`;
  const now = Date.now();

  const make = (project, label, over = {}) => ({
    id: randomUUID(),
    sessionId: `s-${tag}-${label}`,
    project,
    kind: 'context',
    title: `${label} row`,
    body: `${term} appears in the ${label} row`,
    files: [],
    tags: [],
    createdAt: now,
    embedding: [1, 0, 0],
    embedder: `m-${tag}`,
    ...over,
  });
  const rows = {
    A: [make(A, 'a1'), make(A, 'a2')],
    B: [make(B, 'b1'), make(B, 'b2')],
    C: [make(C, 'c1'), make(C, 'c2')],
  };
  await store.insertObservations([...rows.A, ...rows.B, ...rows.C]);
  const idsOf = (...groups) => groups.flatMap((group) => group.map((row) => row.id));

  check(
    'a single project filter still returns only that project',
    sameIds(await store.list({ project: A, limit: 100 }), idsOf(rows.A)),
  );
  check(
    'a list of two projects returns both and leaves the third out',
    sameIds(await store.list({ project: [A, B], limit: 100 }), idsOf(rows.A, rows.B)),
  );
  check(
    'a list with a repeat and an empty name is the same as one project',
    sameIds(await store.list({ project: [A, A, ''], limit: 100 }), idsOf(rows.A)),
  );
  check(
    'an empty list matches nothing instead of everything',
    (await store.list({ project: [], limit: 100 })).length === 0,
  );
  check(
    'a list holding names with quotes, SQL text and non-ASCII works',
    sameIds(await store.list({ project: [B, C], limit: 100 }), idsOf(rows.B, rows.C)),
  );

  const many = [...Array.from({ length: 300 }, (_, i) => `/bulk/${tag}/${i}`), A, B];
  check(
    'a list of 302 projects works',
    sameIds(await store.list({ project: many, limit: 100 }), idsOf(rows.A, rows.B)),
  );

  const found = async (project) =>
    (await store.searchKeyword({ text: term, project, limit: 50 })).map((hit) => hit.id).sort();
  check(
    'keyword search over a list finds both projects and not the third',
    (await found([A, B])).join() === idsOf(rows.A, rows.B).sort().join(),
    String((await found([A, B])).length),
  );
  check(
    'keyword search over one project is unchanged',
    (await found(A)).join() === idsOf(rows.A).sort().join() &&
      (await found([A])).join() === (await found(A)).join(),
  );
  check('keyword search over three projects finds all six', (await found([A, B, C])).length === 6);
  check(
    'keyword search over an empty list finds nothing',
    (await store.searchKeyword({ text: term, project: [], limit: 50 })).length === 0,
  );

  const vectorHits = async (project) =>
    (
      await store.searchVector([1, 0, 0], {
        text: '',
        project,
        limit: 50,
        embedder: `m-${tag}`,
      })
    )
      .map((hit) => hit.id)
      .sort();
  check(
    'vector search over a list finds both projects and not the third',
    (await vectorHits([A, B])).join() === idsOf(rows.A, rows.B).sort().join(),
  );
  check(
    'vector search over one project is unchanged',
    (await vectorHits(A)).join() === idsOf(rows.A).sort().join(),
  );
  check('vector search over an empty list finds nothing', (await vectorHits([])).length === 0);

  const session = (project, label, startedAt, summary) => ({
    id: `sess-${tag}-${label}`,
    project,
    startedAt,
    ...(summary ? { summary } : {}),
  });
  await store.upsertSession(session(A, 'one', now - 3000, 'chat in a'));
  await store.upsertSession(session(B, 'two', now - 2000, 'chat in b'));
  await store.upsertSession(session(C, 'three', now - 1000, 'chat in c'));
  await store.upsertSession(session(A, 'none', now - 500));
  const recent = async (project, limit) =>
    (await store.recentSessions(project, limit)).map((entry) =>
      entry.id.replace(`sess-${tag}-`, ''),
    );
  check(
    'recent chats over a list come newest first, without chats that have no summary',
    (await recent([A, B], 10)).join() === 'two,one',
    (await recent([A, B], 10)).join(),
  );
  check('and the limit applies to the whole list', (await recent([A, B], 1)).join() === 'two');
  check('and one project is unchanged', (await recent(A, 10)).join() === 'one');
  check('and an empty list gives nothing', (await recent([], 10)).length === 0);

  check(
    'removing with an empty list deletes nothing',
    (await store.remove({ project: [] })) === 0 &&
      sameIds(await store.list({ project: [A, B, C], limit: 100 }), idsOf(rows.A, rows.B, rows.C)),
  );

  const removed = await store.remove({ project: [A, B] });
  check('removing a list deletes the rows of every project in it', removed === 4, String(removed));
  check(
    'and leaves the third project and its chat alone',
    (await store.list({ project: [A, B], limit: 100 })).length === 0 &&
      sameIds(await store.list({ project: C, limit: 100 }), idsOf(rows.C)) &&
      (await recent([A, B], 10)).length === 0 &&
      (await recent(C, 10)).join() === 'three',
  );

  await store.remove({ project: C });
}
