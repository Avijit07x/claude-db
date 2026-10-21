import { check } from '../lib/check.mjs';
import { insertObservations } from '../../dist/store/postgres/insert.js';
import { toDoc, toObservation } from '../../dist/store/mongo/docs.js';
import { sessionMatch } from '../../dist/store/mongo/filters.js';
import { excludeSessionsClause } from '../../dist/store/postgres/filters.js';
import { count, getObservations, list } from '../../dist/store/postgres/observations.js';
import { findEdges, scannedFiles } from '../../dist/store/postgres/graph.js';
import { createStore } from '../../dist/store/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function fakePool(rows = []) {
  const seen = [];
  const client = {
    query: async (sql, values) => {
      seen.push({ sql, values: values ?? [] });
      return { rows, rowCount: rows.length };
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

  await leanReads(same);
  await sqliteScopes();
}

const conflictOf = async (obs) => {
  const { pool, seen } = fakePool();
  await insertObservations(pool, async () => true, [obs], true);
  const insert = seen.find((q) => /INSERT INTO observations/.test(q.sql));
  return /ON CONFLICT \(id\) DO UPDATE SET (.+)$/s.exec(insert.sql)?.[1] ?? '';
};

async function leanReads(same) {
  const kept = await conflictOf(observation({ embedder: 'local-384' }));
  check(
    'postgres keeps the stored vector of a row read without one',
    !kept.includes('embedding = NULL') && !kept.includes('embedder ='),
    kept,
  );
  const cleared = await conflictOf(observation());
  check(
    'postgres still clears the vector of a row that has none',
    cleared.includes('embedding = NULL') && cleared.includes('embedder = EXCLUDED.embedder'),
    cleared,
  );
  const fresh = await conflictOf(observation({ embedding: [0.1, 0.2], embedder: 'local-2' }));
  check(
    'postgres writes a new vector over the stored one',
    fresh.includes('embedding = EXCLUDED.embedding') &&
      fresh.includes('embedder = EXCLUDED.embedder'),
    fresh,
  );

  const { pool, seen } = fakePool();
  await list(pool, { project: '/p' });
  await list(pool, { project: '/p', vectors: true });
  await getObservations(pool, ['o1']);
  const [lean, full, byId] = seen.map((q) => q.sql);
  check(
    'postgres lists without the embedding or tsv unless asked',
    !/\*|embedding|tsv/.test(lean) && /\bbody\b/.test(lean),
    lean,
  );
  check('postgres lists every column when vectors are asked for', /SELECT \*/.test(full), full);
  check('postgres fetches by id without the embedding', !/\*|embedding|tsv/.test(byId), byId);

  const tagged = fakePool([{ n: 3 }]);
  const n = await count(tagged.pool, { project: '/p', tag: 'claude-memory', status: 'replaced' });
  const [counted] = tagged.seen;
  check(
    'postgres counts in the database with the same filters as a list',
    n === 3 &&
      /SELECT COUNT\(\*\)/.test(counted.sql) &&
      /status = \$\d/.test(counted.sql) &&
      /tags @> \$\d::jsonb/.test(counted.sql) &&
      counted.values.includes('["claude-memory"]'),
    counted.sql,
  );

  const edges = fakePool([{ id: 'e1', src_id: 'a', dst_id: 'b', line: 3, score: 1 }]);
  const [edge] = await findEdges(edges.pool, { project: '/p' });
  check(
    'postgres fills a graph row project from the filter, not the wire',
    edge.project === '/p' && !/SELECT \*|project,/.test(edges.seen[0].sql),
    edges.seen[0].sql,
  );
  const files = fakePool([{ path: 'a.ts', hash: 'h', scanned_at: 1 }]);
  const [file] = await scannedFiles(files.pool, '/p', 1);
  check(
    'postgres can ask whether a project was scanned with one row',
    file.project === '/p' &&
      /LIMIT \$2/.test(files.seen[0].sql) &&
      same(files.seen[0].values, ['/p', 1]),
    files.seen[0].sql,
  );
}

async function sqliteScopes() {
  const dir = mkdtempSync(join(tmpdir(), 'cdb-scopes-'));
  const store = await createStore(join(dir, 'memory.db'));
  try {
    await store.init();
    await store.insertObservations([
      observation({ id: 'a', tags: ['claude-memory'] }),
      observation({ id: 'b', tags: ['other'], status: 'replaced' }),
      observation({ id: 'c', tags: ['claude-memory', 'other'], status: 'replaced' }),
    ]);
    const ids = (rows) => rows.map((obs) => obs.id).join(',');
    check(
      'sqlite lists only rows carrying a tag',
      ids(await store.list({ project: '/p', tag: 'claude-memory' })) === 'a,c',
    );
    check(
      'sqlite counts rows with the list filters',
      (await store.count({ project: '/p' })) === 3 &&
        (await store.count({ project: '/p', status: 'replaced' })) === 2 &&
        (await store.count({ project: '/p', tag: 'other', status: 'replaced' })) === 2 &&
        (await store.count({ project: [] })) === 0,
    );
    await store.upsertGraph({
      symbols: [],
      edges: [],
      files: ['x.ts', 'y.ts'].map((path) => ({ project: '/p', path, hash: 'h', scannedAt: 1 })),
    });
    check(
      'sqlite caps scanned files when asked',
      (await store.scannedFiles('/p', 1)).length === 1 &&
        (await store.scannedFiles('/p')).length === 2,
    );
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
