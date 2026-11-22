import { randomUUID } from 'node:crypto';
import { BASE_TIME, EMBEDDER, inFreshProjects, makeRow, near } from './contract-kit.mjs';

const KINDS = ['decision', 'pattern', 'bugfix', 'context', 'deadend', 'preference'];
const FIELDS = [
  'id',
  'sessionId',
  'project',
  'kind',
  'title',
  'body',
  'files',
  'tags',
  'createdAt',
  'embedder',
  'author',
  'status',
];
const VECTOR = [0.5, 0.25, -1];

const sameFields = (actual, expected) =>
  FIELDS.every((field) => JSON.stringify(actual?.[field]) === JSON.stringify(expected[field]));

const withoutIdentity = ({ id, project, ...rest }) => JSON.stringify(rest);

const copyOf = (row, project) => ({ ...row, id: randomUUID(), project });

async function checkEveryField(store, check) {
  await inFreshProjects(store, 'fields', 1, async (project) => {
    const full = makeRow(project, {
      sessionId: 'chat-it\'s "one"',
      kind: 'deadend',
      title: 'It\'s a "quoted" title, 日本語 and ünïcode',
      body: 'line one\nline two with % _ * [x] \\ and a tab\t',
      files: ['/src/a.ts', '/src/with space/b.ts'],
      tags: ['alpha', 'beta'],
      createdAt: BASE_TIME + 123,
      embedding: VECTOR,
      embedder: EMBEDDER,
      author: 'casey',
      status: 'open',
    });
    const bare = makeRow(project, { createdAt: BASE_TIME + 456 });
    const byKind = KINDS.map((kind) => makeRow(project, { kind }));
    await store.insertObservations([full, bare, ...byKind]);

    const [back] = await store.getObservations([full.id]);
    check('contract: every field of a row reads back as written', sameFields(back, full));

    const withVectors = await store.list({ project, vectors: true, limit: 100 });
    const stored = withVectors.find((row) => row.id === full.id);
    check('contract: a vector reads back with vectors asked for', near(stored?.embedding, VECTOR));

    const [plain] = await store.getObservations([bare.id]);
    check(
      'contract: a row with no optional fields reads back with none, and the default status',
      sameFields(plain, { ...bare, embedder: undefined, author: undefined, status: 'done' }) &&
        plain.embedding === undefined,
    );

    const kinds = await store.getObservations(byKind.map((row) => row.id));
    check(
      'contract: every kind round-trips',
      byKind.every((row) => kinds.find((back) => back.id === row.id)?.kind === row.kind),
    );
  });
}

async function checkCopy(store, check) {
  await inFreshProjects(store, 'copy', 2, async (source, target) => {
    const originals = [
      makeRow(source, { title: 'with a vector', embedding: VECTOR, embedder: EMBEDDER }),
      makeRow(source, {
        title: 'open work',
        status: 'open',
        files: ['/x.ts'],
        createdAt: BASE_TIME + 1,
      }),
      makeRow(source, {
        title: 'replaced',
        status: 'replaced',
        tags: ['t'],
        createdAt: BASE_TIME + 2,
      }),
      makeRow(source, { title: 'authored', author: 'casey', createdAt: BASE_TIME + 3 }),
    ];
    await store.insertObservations(originals);
    const read = await store.list({ project: source, vectors: true, limit: 100 });

    await store.insertObservations(read.map((row) => copyOf(row, target)));
    const copied = await store.list({ project: target, vectors: true, limit: 100 });
    check(
      'contract: a copy to a second project equals the original',
      read.length === originals.length &&
        copied.length === read.length &&
        read.every((row, index) => withoutIdentity(row) === withoutIdentity(copied[index])),
    );

    await store.insertObservations(read);
    const again = await store.list({ project: source, vectors: true, limit: 100 });
    check(
      'contract: saving the rows just read changes nothing',
      JSON.stringify(again) === JSON.stringify(read),
    );
  });
}

export default async function run({ store }, check) {
  await checkEveryField(store, check);
  await checkCopy(store, check);
}
