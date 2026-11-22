import {
  BASE_TIME,
  EMBEDDER,
  hasAtlasVectorIndex,
  idsOf,
  inFreshProjects,
  makeRow,
  uniqueWord,
} from './contract-kit.mjs';

const QUERY_LIMIT = 10;
const VECTOR_LIMIT = 10;
const QUERY_VECTOR = [1, 0, 0];

async function checkResave(store, search, check) {
  await inFreshProjects(store, 'resave', 1, async (project) => {
    const before = uniqueWord('quasar');
    const after = uniqueWord('nebula');
    const row = makeRow(project, { title: `${before} cache`, body: `${before} first pass` });
    await store.insertObservations([row]);
    await store.insertObservations([
      { ...row, title: `${after} cache`, body: `${after} second pass` },
    ]);

    const hitsFor = async (text) =>
      idsOf(await search.search({ text, project, limit: QUERY_LIMIT }));
    check(
      'contract: a saved row again is found by its new text and no longer by its old text',
      (await hitsFor(after)).join() === row.id && (await hitsFor(before)).length === 0,
    );
  });
}

async function checkPlainWords(store, search, check) {
  await inFreshProjects(store, 'words', 1, async (project) => {
    const [alder, birch, cedar] = ['alder', 'birch', 'cedar'].map(uniqueWord);
    const rows = [alder, birch, cedar].map((word) =>
      makeRow(project, { title: `notes on ${word}`, body: `the ${word} row and nothing else` }),
    );
    const [alderRow, birchRow, cedarRow] = rows;
    await store.insertObservations(rows);

    const hitsFor = async (text) =>
      idsOf(await search.search({ text, project, limit: QUERY_LIMIT }));
    check(
      'contract: a leading minus is a plain word, not a ban',
      (await hitsFor(`-${cedar}`)).includes(cedarRow.id),
    );
    check(
      'contract: quotes are plain punctuation',
      (await hitsFor(`"${alder}"`)).includes(alderRow.id),
    );
    check(
      'contract: a star is plain punctuation',
      (await hitsFor(`${birch}*`)).includes(birchRow.id),
    );
    const either = await hitsFor(`${alder} OR ${birch}`);
    check(
      'contract: OR between words finds a row with either word',
      either.includes(alderRow.id) && either.includes(birchRow.id) && !either.includes(cedarRow.id),
    );
    check(
      'contract: NEAR( is a plain word next to another word',
      (await hitsFor(`NEAR( ${cedar}`)).join() === cedarRow.id,
    );
    const operatorsOnly = await Promise.all(['*', '"', 'OR', 'NEAR(', '-', '( )'].map(hitsFor));
    check(
      'contract: a query of operators alone finds nothing',
      operatorsOnly.every((hits) => hits.length === 0),
    );
  });
}

const VECTOR_ROWS = [
  { name: 'best', vector: [1, 0, 0], kind: 'decision', tags: ['x'], age: 3000, sessionId: 's1' },
  {
    name: 'close',
    vector: [0.8, 0.6, 0],
    kind: 'decision',
    tags: ['x'],
    age: 2000,
    sessionId: 's2',
  },
  { name: 'right', vector: [0, 1, 0], kind: 'bugfix', tags: [], age: 1000, sessionId: 's1' },
  { name: 'worst', vector: [-1, 0, 0], kind: 'decision', tags: ['x'], age: 0, sessionId: 's2' },
];

async function checkVectorSearch(store, check) {
  await inFreshProjects(store, 'vectors', 2, async (project, other) => {
    const make = (owner, spec, over = {}) =>
      makeRow(owner, {
        kind: spec.kind,
        tags: spec.tags,
        sessionId: spec.sessionId,
        createdAt: BASE_TIME - spec.age,
        embedding: spec.vector,
        embedder: EMBEDDER,
        ...over,
      });
    const byName = Object.fromEntries(VECTOR_ROWS.map((spec) => [spec.name, make(project, spec)]));
    const replaced = make(project, VECTOR_ROWS[0], { status: 'replaced' });
    const elsewhere = make(other, VECTOR_ROWS[1]);
    await store.insertObservations([...Object.values(byName), replaced, elsewhere]);

    const found = async (over = {}) =>
      idsOf(
        await store.searchVector(QUERY_VECTOR, {
          text: '',
          project,
          limit: VECTOR_LIMIT,
          embedder: EMBEDDER,
          ...over,
        }),
      );
    const expectOrder = async (over, ...names) =>
      (await found(over)).join() === names.map((name) => byName[name].id).join();

    check(
      'contract: vector search runs from the closest row to the furthest, in its project, without replaced rows',
      await expectOrder({}, 'best', 'close', 'right', 'worst'),
    );
    check(
      'contract: vector search honours the limit',
      await expectOrder({ limit: 2 }, 'best', 'close'),
    );
    check(
      'contract: vector search filters by kind',
      await expectOrder({ kind: 'decision' }, 'best', 'close', 'worst'),
    );
    check(
      'contract: vector search filters by whole tag',
      await expectOrder({ tag: 'x' }, 'best', 'close', 'worst'),
    );
    check('contract: a tag nobody has finds nothing', (await found({ tag: 'xx' })).length === 0);
    check(
      'contract: vector search filters from a time and up to a time',
      (await expectOrder({ since: BASE_TIME - 2000 }, 'close', 'right', 'worst')) &&
        (await expectOrder({ until: BASE_TIME - 2000 }, 'best', 'close')),
    );
    check(
      'contract: vector search can leave out a chat',
      await expectOrder({ excludeSessions: ['s1'] }, 'close', 'worst'),
    );
    const both = await found({ project: [project, other] });
    check(
      'contract: vector search over a list of projects reaches both',
      both.includes(elsewhere.id) && both.includes(byName.best.id) && !both.includes(replaced.id),
    );
  });
}

export default async function run({ store, search }, check) {
  await checkResave(store, search, check);
  await checkPlainWords(store, search, check);
  if (await hasAtlasVectorIndex(store)) {
    console.log('SKIP  contract: vector search filters, Atlas ranks with its own index');
    return;
  }
  await checkVectorSearch(store, check);
}
