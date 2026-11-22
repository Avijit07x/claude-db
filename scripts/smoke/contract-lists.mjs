import {
  BASE_TIME,
  EMBEDDER,
  idsOf,
  inFreshProjects,
  makeRow,
  near,
  sameIds,
} from './contract-kit.mjs';

const PAGE_SIZE = 2;
const MAX_PAGES = 20;
const TIED_ROWS = 5;

async function walk(store, project) {
  const seen = [];
  let cursor = {};
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const rows = await store.list({ project, limit: PAGE_SIZE, ...cursor });
    if (rows.length === 0) break;
    seen.push(...rows);
    const last = rows[rows.length - 1];
    cursor = { after: last.createdAt, afterId: last.id };
  }
  return seen;
}

async function checkOrder(store, check) {
  await inFreshProjects(store, 'order', 1, async (project) => {
    const earliest = makeRow(project, { createdAt: BASE_TIME - 1000 });
    const latest = makeRow(project, { createdAt: BASE_TIME + 1000 });
    const tied = Array.from({ length: TIED_ROWS }, () => makeRow(project));
    await store.insertObservations([latest, ...tied, earliest]);

    const oldestFirst = await store.list({ project, limit: 100 });
    const ids = idsOf(oldestFirst);
    check(
      'contract: list runs oldest first, and rows made at one time stay in one fixed order',
      ids.length === tied.length + 2 && ids[0] === earliest.id && ids.at(-1) === latest.id,
    );
    check(
      'contract: a cursor of time and id pages through tied rows without a repeat or a skip',
      idsOf(await walk(store, project)).join() === ids.join(),
    );
    check(
      'contract: a cursor of time alone moves past every row made at that time',
      idsOf(await store.list({ project, after: BASE_TIME, limit: 100 })).join() === latest.id,
    );
    check(
      'contract: newest first is the exact reverse',
      idsOf(await store.list({ project, newest: true, limit: 100 })).join() ===
        [...ids].reverse().join(),
    );
    check(
      'contract: a limit keeps the first rows of the order',
      idsOf(await store.list({ project, limit: 3 })).join() === ids.slice(0, 3).join(),
    );
  });
}

const COUNT_ROWS = [
  { kind: 'decision', status: 'open', tags: ['a'], sessionId: 's1' },
  { kind: 'decision', status: 'done', tags: ['a', 'b'], sessionId: 's1' },
  { kind: 'bugfix', status: 'done', tags: ['b'], sessionId: 's2' },
  { kind: 'bugfix', status: 'replaced', tags: [], sessionId: 's2' },
  { kind: 'pattern', status: 'open', tags: ['a'], sessionId: 's3' },
  { kind: 'context', status: 'done', tags: [], sessionId: 's3' },
];

const COUNT_FILTERS = [
  [{}, 6],
  [{ kind: 'decision' }, 2],
  [{ status: 'open' }, 2],
  [{ tag: 'a' }, 3],
  [{ tag: 'b' }, 2],
  [{ tag: 'ab' }, 0],
  [{ sessionId: 's2' }, 2],
  [{ excludeSessions: ['s1'] }, 4],
  [{ excludeSessions: ['s1', 's2'] }, 2],
  [{ kind: 'bugfix', status: 'done' }, 1],
  [{ tag: 'a', status: 'open' }, 2],
  [{ sessionId: 's1', excludeSessions: ['s1'] }, 0],
];

async function checkCount(store, check) {
  await inFreshProjects(store, 'count', 1, async (project) => {
    await store.insertObservations(COUNT_ROWS.map((over) => makeRow(project, over)));
    const mismatches = [];
    for (const [filter, expected] of COUNT_FILTERS) {
      const counted = await store.count({ project, ...filter });
      const listed = (await store.list({ project, limit: 100, ...filter })).length;
      if (counted !== expected || listed !== expected) {
        mismatches.push(
          `${JSON.stringify(filter)}: count ${counted}, list ${listed}, want ${expected}`,
        );
      }
    }
    check('contract: count equals list for every filter', mismatches.length === 0, mismatches[0]);
  });
}

async function checkShapes(store, check) {
  await inFreshProjects(store, 'shapes', 1, async (project) => {
    const withVector = makeRow(project, {
      title: 'has a vector',
      body: 'a body that is long enough to notice',
      embedding: [0.25, 0.5, 1],
      embedder: EMBEDDER,
    });
    const without = makeRow(project, { title: 'has none', createdAt: BASE_TIME + 1 });
    await store.insertObservations([withVector, without]);

    const full = await store.list({ project, limit: 100 });
    const titles = await store.list({ project, bodies: false, limit: 100 });
    check(
      'contract: bodies off still lists the same rows with their titles',
      titles.length === full.length &&
        titles.every((row, index) => row.id === full[index].id && row.title === full[index].title),
    );
    check(
      'contract: a list with bodies on carries them',
      full.find((row) => row.id === withVector.id)?.body === withVector.body,
    );

    const vectors = await store.list({ project, vectors: true, limit: 100 });
    const [first, second] = vectors;
    check(
      'contract: vectors on returns the vector of a row that has one and none for a row that has none',
      first?.id === withVector.id &&
        near(first.embedding, withVector.embedding) &&
        first.embedder === EMBEDDER &&
        second?.id === without.id &&
        !second.embedding,
    );
  });
}

async function checkStale(store, check) {
  await inFreshProjects(store, 'stale', 1, async (project) => {
    const vector = [1, 0, 0];
    const current = makeRow(project, { embedding: vector, embedder: 'model-1' });
    const older = makeRow(project, { embedding: vector, embedder: 'model-0' });
    const missing = makeRow(project);
    await store.insertObservations([current, older, missing]);

    const lacking = await store.list({ project, vectorStale: {}, limit: 100 });
    check(
      'contract: stale listing with no embedder asks only for rows without a vector',
      sameIds(idsOf(lacking), [missing.id]),
    );
    const stale = await store.list({ project, vectorStale: { embedder: 'model-1' }, limit: 100 });
    check(
      'contract: stale listing with an embedder adds rows made by another one',
      sameIds(idsOf(stale), [older.id, missing.id]),
    );
  });
}

export default async function run({ store }, check) {
  await checkOrder(store, check);
  await checkCount(store, check);
  await checkShapes(store, check);
  await checkStale(store, check);
}
