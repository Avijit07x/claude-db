import { check } from '../lib/check.mjs';
import { insertObservations } from '../../dist/store/postgres/insert.js';
import { toDoc, toObservation } from '../../dist/store/mongo/docs.js';
import { sessionMatch } from '../../dist/store/mongo/filters.js';
import { excludeSessionsClause } from '../../dist/store/postgres/filters.js';

function fakePool() {
  const seen = [];
  const client = {
    query: async (sql, values) => {
      seen.push({ sql, values: values ?? [] });
      return { rows: [], rowCount: 0 };
    },
    release: () => {},
  };
  return { pool: { connect: async () => client, query: client.query }, seen };
}

const observation = (over = {}) => ({
  id: 'o1',
  sessionId: 's1',
  project: '/p',
  kind: 'decision',
  title: 't',
  body: 'b',
  files: ['/p/a.ts'],
  tags: ['x'],
  createdAt: 1,
  ...over,
});

export default async function run() {
  const { pool, seen } = fakePool();
  await insertObservations(pool, async () => false, [observation({ status: 'open' })]);

  const insert = seen.find((q) => /INSERT INTO observations/.test(q.sql));
  check('postgres issues an insert', insert !== undefined);

  const columns = /INSERT INTO observations \(([^)]+)\)/.exec(insert.sql)?.[1].split(', ') ?? [];
  const holes = /VALUES \(([^)]+)\)/.exec(insert.sql)?.[1].split(', ') ?? [];
  check(
    'postgres columns and placeholders line up',
    columns.length === holes.length && columns.length === insert.values.length,
    `${columns.length} cols / ${holes.length} holes / ${insert.values.length} values`,
  );

  check('postgres persists status', columns.includes('status'), columns.join(','));
  check(
    'postgres writes the status it was given, not the default',
    insert.values[columns.indexOf('status')] === 'open',
    String(insert.values[columns.indexOf('status')]),
  );

  const persisted = [
    'id',
    'session_id',
    'project',
    'kind',
    'title',
    'body',
    'files',
    'tags',
    'created_at',
    'embedder',
    'author',
    'status',
  ];
  const missing = persisted.filter((c) => !columns.includes(c));
  check('postgres persists every column it is meant to', missing.length === 0, missing.join(','));

  const conflict = /ON CONFLICT \(id\) DO UPDATE SET (.+)$/s.exec(insert.sql)?.[1] ?? '';
  check(
    're-ingesting updates status rather than leaving the old value',
    conflict.includes('status = EXCLUDED.status'),
  );

  const doc = toDoc(observation({ status: 'open' }));
  check('mongo persists status', doc.status === 'open', String(doc.status));
  check('mongo reads status back', toObservation({ ...doc, _id: 'o1' }).status === 'open');
  check('mongo defaults a statusless observation to done', toDoc(observation()).status === 'done');

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check('mongo adds no chat filter when none is asked for', same(sessionMatch(undefined, []), {}));
  check(
    'mongo can ask for one chat and leave out others in one filter',
    same(sessionMatch('a', ['b', 'c']), { sessionId: { $eq: 'a', $nin: ['b', 'c'] } }),
  );
  check(
    'mongo can leave out chats alone',
    same(sessionMatch(undefined, ['b']), { sessionId: { $nin: ['b'] } }),
  );

  const values = ['/p'];
  check(
    'postgres adds no chat filter for an empty list',
    excludeSessionsClause([], values) === null && values.length === 1,
  );
  check(
    'postgres leaves out chats with one array value',
    excludeSessionsClause(['b', 'c'], values) === 'session_id <> ALL($2::text[])' &&
      same(values[1], ['b', 'c']),
  );
}
