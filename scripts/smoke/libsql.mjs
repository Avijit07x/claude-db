import { randomUUID } from 'node:crypto';

function countRequests(client) {
  const counts = { requests: 0, statements: 0 };
  const execute = client.execute.bind(client);
  const batch = client.batch.bind(client);
  client.execute = (statement) => {
    counts.requests += 1;
    counts.statements += 1;
    return execute(statement);
  };
  client.batch = (statements, mode) => {
    counts.requests += 1;
    counts.statements += statements.length;
    return batch(statements, mode);
  };
  return {
    counts,
    restore() {
      client.execute = execute;
      client.batch = batch;
    },
  };
}

const rowid = async (client, id) =>
  Number(
    (await client.execute({ sql: 'SELECT rowid AS r FROM observations WHERE id = ?', args: [id] }))
      .rows[0]?.r,
  );

export default async function run({ store, project, now, sessionId, expected }, check) {
  if (expected !== 'libsql') return;
  const { client } = store;

  const base = {
    sessionId,
    project,
    kind: 'context',
    files: [],
    tags: ['libsql'],
    createdAt: now,
  };
  const vectored = {
    ...base,
    id: randomUUID(),
    title: 'Vectored row for libsql',
    body: 'carries a vector',
    embedding: [0.6, 0.8, 0],
    embedder: 'libsql-model',
  };
  const plain = { ...base, id: randomUUID(), title: 'Plain row', body: 'no vector' };

  const many = countRequests(client);
  await store.insertObservations([vectored, plain]);
  many.restore();
  check(
    'libsql: one round trip writes rows with and without a vector',
    many.counts.requests === 1,
    `${many.counts.requests} requests`,
  );

  const lean = (await store.list({ project, tag: 'libsql', limit: 10 })).find(
    (row) => row.id === vectored.id,
  );
  check('libsql: list leaves the vector out unless asked', lean && !lean.embedding);

  const before = await rowid(client, vectored.id);
  await store.insertObservations([{ ...lean, body: 'carries a vector, edited' }]);
  const kept = (await store.list({ project, tag: 'libsql', limit: 10, vectors: true })).find(
    (row) => row.id === vectored.id,
  );
  check(
    'libsql: saving a row read without its vector keeps the stored one',
    kept?.embedding?.length === 3 && kept.embedder === 'libsql-model',
    `${kept?.embedder} / ${kept?.embedding?.length ?? 0}d`,
  );
  check(
    'libsql: an upsert updates in place, keeping the rowid',
    (await rowid(client, vectored.id)) === before,
  );

  await store.insertObservations([
    {
      ...base,
      id: randomUUID(),
      title: 'Wide',
      body: 'w',
      embedding: [1, 0, 0, 0],
      embedder: 'other',
    },
  ]);
  let error = null;
  let hits = [];
  try {
    hits = await store.searchVector([0.6, 0.8, 0], { text: '', project, limit: 5 });
  } catch (caught) {
    error = caught;
  }
  check(
    'libsql: vector search skips rows of another width instead of failing',
    error === null && hits[0]?.id === vectored.id,
    error?.message ?? hits.map((hit) => hit.title).join(' | '),
  );
  check(
    'libsql: vector scores are cosine similarity',
    Math.abs((hits[0]?.score ?? 0) - 1) < 1e-6,
    String(hits[0]?.score),
  );

  const graph = {
    symbols: Array.from({ length: 3000 }, (_, i) => ({
      id: `libsql-sym-${i}`,
      project,
      name: `fn${i}`,
      kind: 'function',
      file: `src/f${i % 50}.ts`,
      line: i + 1,
      lang: 'typescript',
      signature: `function fn${i}() {`,
    })),
    edges: Array.from({ length: 3000 }, (_, i) => ({
      id: `libsql-edge-${i}`,
      project,
      srcId: `libsql-sym-${i}`,
      srcName: `fn${i}`,
      dstId: `libsql-sym-${(i + 1) % 3000}`,
      dstName: `fn${(i + 1) % 3000}`,
      relation: 'calls',
      confidence: 'resolved',
      score: 0.5,
      file: `src/f${i % 50}.ts`,
      line: i + 1,
    })),
    files: Array.from({ length: 50 }, (_, i) => ({
      project,
      path: `src/f${i}.ts`,
      hash: `h${i}`,
      scannedAt: now,
    })),
  };
  const writes = countRequests(client);
  await store.replaceGraph(project, null, graph);
  writes.restore();
  check(
    'libsql: a whole graph is replaced in one round trip',
    writes.counts.requests === 1,
    `${writes.counts.requests} requests, ${writes.counts.statements} statements`,
  );
  const edges = await store.findEdges({ project, srcIds: ['libsql-sym-7'], limit: 10 });
  check(
    'libsql: graph rows keep their types',
    edges.length === 1 && edges[0].score === 0.5 && edges[0].line === 8,
    JSON.stringify(edges[0]),
  );
  const frontier = Array.from({ length: 2500 }, (_, i) => `libsql-sym-${i}`);
  check(
    'libsql: a large id list is one parameter, not thousands',
    (await store.findEdges({ project, srcIds: frontier, limit: 5000 })).length === 2500,
  );
  const moved = {
    symbols: graph.symbols.filter((symbol) => symbol.file === 'src/f1.ts').slice(1),
    edges: graph.edges
      .filter((edge) => edge.file === 'src/f1.ts')
      .map((edge, i) =>
        i === 0 ? { ...edge, id: `${edge.id}-moved`, line: edge.line + 1 } : edge,
      ),
    files: graph.files.filter((file) => file.path === 'src/f1.ts'),
  };
  await store.replaceGraph(project, ['src/f1.ts'], moved);
  const f1 = await store.findSymbols({ project, file: 'src/f1.ts', limit: 500 });
  const f1Edges = await store.findEdges({
    project,
    srcIds: f1.map((s) => s.id).concat('libsql-sym-1'),
    limit: 500,
  });
  check(
    'libsql: a rescan drops rows that are gone and keeps the rest',
    f1.length === 59 &&
      !f1.some((s) => s.id === 'libsql-sym-1') &&
      f1Edges.some((e) => e.id === 'libsql-edge-1-moved') &&
      !f1Edges.some((e) => e.id === 'libsql-edge-1'),
    `${f1.length} symbols`,
  );
  check(
    'libsql: removing some files removes only their rows',
    (await store.removeGraph(project, ['src/f0.ts'])) === 60,
  );
  await store.removeGraph(project);
}
