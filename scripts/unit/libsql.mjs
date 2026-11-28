import { check } from '../lib/check.mjs';
import { LibsqlStore } from '../../dist/store/libsql/index.js';
import { SCHEMA_VERSION } from '../../dist/store/libsql/schema.js';
import { insertStatements } from '../../dist/store/libsql/insert.js';
import { writeMarker } from '../../dist/store/libsql/schema-guard.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function fakeClient({ rows = [], fail } = {}) {
  const seen = { requests: [] };
  const answer = (statement) => {
    if (fail?.test(statement.sql)) throw new Error(`SQLite error: ${fail.source}`);
    return { rows: typeof rows === 'function' ? rows(statement) : rows, rowsAffected: 0 };
  };
  const client = {
    execute: async (statement) => {
      seen.requests.push([statement]);
      return answer(statement);
    },
    batch: async (statements) => {
      seen.requests.push(statements);
      return statements.map(answer);
    },
    close: () => {},
  };
  return { client, seen };
}

const observation = (over = {}) => ({
  id: 'o1',
  sessionId: 's1',
  project: '/p',
  kind: 'decision',
  title: 't',
  body: 'b',
  files: [],
  tags: [],
  createdAt: 1,
  ...over,
});

const sqlOf = (seen) => seen.requests.flat().map((statement) => statement.sql);

export default async function run() {
  await init();
  await marker();
  await reads();
  await writes();
  await graph();
}

async function init() {
  const warm = fakeClient({ rows: [{ version: SCHEMA_VERSION }] });
  await new LibsqlStore(warm.client).init();
  check(
    'libsql: init on a current schema costs one round trip',
    warm.seen.requests.length === 1,
    `${warm.seen.requests.length} requests`,
  );

  const cold = fakeClient();
  await new LibsqlStore(cold.client).init();
  check(
    'libsql: init on a new database sends the schema in one batch',
    cold.seen.requests.length === 2 && cold.seen.requests[1].length > 10,
    `${cold.seen.requests.length} requests`,
  );
  check(
    'libsql: the schema sets no pragmas a server would refuse',
    !sqlOf(cold.seen).some((sql) => /PRAGMA/i.test(sql)),
  );

  const noFts = fakeClient({ fail: /fts5/ });
  let message = '';
  try {
    await new LibsqlStore(noFts.client).init();
  } catch (error) {
    message = error.message;
  }
  check(
    'libsql: a database without FTS5 gets a clear error naming the Turso engine',
    /FTS5/.test(message) && /--tursodb/.test(message),
    message,
  );
}

async function reads() {
  const { client, seen } = fakeClient();
  const store = new LibsqlStore(client);
  await store.list({ project: '/p' });
  await store.list({ project: '/p', bodies: false });
  await store.getObservations(['o1', 'o2']);
  await store.list({ project: '/p', vectors: true });
  const [lean, titles, byId, full] = sqlOf(seen);
  check(
    'libsql: list and get read neither the vector nor SELECT *',
    ![lean, titles, byId].some((sql) => /\*|embedding/.test(sql)),
  );
  check('libsql: list can leave bodies out', !/\bbody\b/.test(titles));
  check('libsql: list reads vectors when asked', /embedding/.test(full));

  const search = fakeClient();
  await new LibsqlStore(search.client).searchVector([0.6, 0.8, 0], {
    text: '',
    project: '/p',
    limit: 5,
  });
  const [vector] = sqlOf(search.seen);
  const args = search.seen.requests[0][0].args;
  check(
    'libsql: vector search ranks in the database and returns no vectors',
    /vector_distance_cos/.test(vector) && !/SELECT[^(]*\bembedding\b[^(]*FROM \(/s.test(vector),
  );
  check(
    'libsql: vector search sends the query as packed float32, not text',
    args[0] instanceof Uint8Array && args[0].byteLength === 12,
  );

  const timeline = fakeClient();
  await new LibsqlStore(timeline.client).timeline({ observationId: 'o1', before: 2, after: 2 });
  check('libsql: timeline is one round trip', timeline.seen.requests.length === 1);
}

async function writes() {
  const [written, kept] = insertStatements([
    observation({ id: 'a', embedding: [1, 0], embedder: 'm' }),
    observation({ id: 'b', embedder: 'm' }),
  ]);
  check(
    'libsql: a row read without its vector keeps the stored one on save',
    !/embedding = excluded/.test(kept.sql) && /embedding = excluded/.test(written.sql),
  );
  check(
    'libsql: an unchanged row is not rewritten',
    /DO UPDATE SET .+ WHERE observations\.\w+ IS NOT excluded/s.test(written.sql),
  );
  check('libsql: upserts never use INSERT OR REPLACE', !/OR REPLACE/.test(written.sql));

  const many = Array.from({ length: 450 }, (_, i) => observation({ id: `o${i}` }));
  const { client, seen } = fakeClient();
  await new LibsqlStore(client).insertObservations(many);
  check(
    'libsql: hundreds of rows are one round trip',
    seen.requests.length === 1 && seen.requests[0].length === 3,
    `${seen.requests.length} requests, ${seen.requests[0]?.length} statements`,
  );

  const removal = fakeClient();
  await new LibsqlStore(removal.client).remove({ project: '/p' });
  check(
    'libsql: wiping a project is one round trip with no VACUUM',
    removal.seen.requests.length === 1 && !sqlOf(removal.seen).some((sql) => /VACUUM/.test(sql)),
  );
}

async function graph() {
  const symbols = Array.from({ length: 60000 }, (_, i) => ({
    id: `s${i}`,
    project: '/p',
    name: `name${i}`,
    kind: 'function',
    file: `src/${i}.ts`,
    line: i,
    lang: 'typescript',
    signature: 'x'.repeat(120),
  }));

  const small = fakeClient();
  await new LibsqlStore(small.client).replaceGraph('/p', ['src/1.ts'], {
    symbols: symbols.slice(0, 5000),
    edges: [],
    files: [],
  });
  check(
    'libsql: a graph replace is one batch carrying one JSON value per 2000 rows',
    small.seen.requests.length === 1 &&
      small.seen.requests[0].every((statement) => statement.args.length <= 3),
  );
  const [staleSymbols] = small.seen.requests[0];
  check(
    'libsql: a rescan deletes only rows that are gone, not every row of the file',
    /DELETE FROM symbols .+ AND id NOT IN/s.test(staleSymbols.sql),
  );
  const upsert = small.seen.requests[0].find((statement) =>
    /INSERT INTO symbols/.test(statement.sql),
  );
  check(
    'libsql: a rescan rewrites only rows that changed',
    /DO UPDATE SET\s.+ WHERE symbols\.\w+ IS NOT excluded/s.test(upsert.sql),
  );

  const files = Array.from({ length: 2000 }, (_, i) => ({
    project: '/p',
    path: `src/${i}.ts`,
    hash: 'h',
    scannedAt: 1,
  }));
  const huge = Array.from({ length: 4 }, (_, n) =>
    symbols.map((symbol) => ({ ...symbol, id: `${symbol.id}-${n}`, signature: 'x'.repeat(400) })),
  ).flat();
  const big = fakeClient();
  await new LibsqlStore(big.client).replaceGraph('/p', null, { symbols: huge, edges: [], files });
  const order = big.seen.requests.flat().map((statement) => statement.sql);
  check(
    'libsql: a graph too big for one request is sent in order, with the file cache last',
    big.seen.requests.length > 1 &&
      /DELETE FROM symbols/.test(order[0]) &&
      /scanned_files/.test(order.at(-1)),
    `${big.seen.requests.length} requests`,
  );

  const wide = symbols.slice(0, 3000).map((symbol) => ({
    ...symbol,
    signature: '漢'.repeat(4000),
  }));
  const utf8 = fakeClient();
  await new LibsqlStore(utf8.client).replaceGraph('/p', null, {
    symbols: wide,
    edges: [],
    files: [],
  });
  check(
    'libsql: a graph over the limit in UTF-8 bytes is split, even when its text is shorter',
    utf8.seen.requests.length > 1,
    `${utf8.seen.requests.length} requests`,
  );

  const edges = fakeClient();
  await new LibsqlStore(edges.client).findEdges({
    project: '/p',
    srcIds: Array.from({ length: 3000 }, (_, i) => `s${i}`),
  });
  check(
    'libsql: an id list of any size is one parameter',
    edges.seen.requests[0][0].args.length === 3,
  );
}

async function marker() {
  const dir = mkdtempSync(join(tmpdir(), 'libsql-marker-'));
  const path = join(dir, 'db');

  const fresh = fakeClient();
  await new LibsqlStore(fresh.client, path).init();
  const known = fakeClient({ rows: [{ version: SCHEMA_VERSION }] });
  await new LibsqlStore(known.client, path).init();
  check(
    'libsql: a process that has seen the schema skips the check',
    fresh.seen.requests.length === 2 && known.seen.requests.length === 0,
    `${known.seen.requests.length} requests`,
  );

  let missing = true;
  const healing = fakeClient({
    rows: (statement) => {
      if (missing && /FROM observations/.test(statement.sql)) {
        missing = false;
        throw new Error('SQLite error: no such table: observations');
      }
      return [{ n: 3 }];
    },
  });
  writeMarker(path, SCHEMA_VERSION);
  const store = new LibsqlStore(healing.client, path);
  await store.init();
  const counted = await store.count({ project: '/p' });
  check(
    'libsql: a database reset behind a stale marker gets its schema back and the query retried',
    counted === 3 && healing.seen.requests.length === 3 && healing.seen.requests[1].length > 10,
    `${healing.seen.requests.length} requests`,
  );

  const links = fakeClient({ rows: [{ value: '/p-key' }] });
  const scoped = new LibsqlStore(links.client, join(dir, 'scoped'));
  await scoped.projectScope('/p');
  await scoped.projectScope('/p');
  const cachedRequests = links.seen.requests.length;
  await scoped.linkProject('/p', '/other-key');
  await scoped.projectScope('/p');
  check(
    'libsql: the project scope is read once per process and again after a link',
    cachedRequests === 1 && links.seen.requests.length === 3,
    `${cachedRequests} then ${links.seen.requests.length}`,
  );
  rmSync(dir, { recursive: true, force: true });
}
