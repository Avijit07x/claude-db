export default async function run({ store, project, expected }, check) {
  const symbols = [
    {
      id: 'sym-widget',
      project,
      name: 'Widget',
      kind: 'class',
      file: 'src/widget.ts',
      line: 3,
      lang: 'typescript',
      signature: 'export class Widget {',
    },
    {
      id: 'sym-build',
      project,
      name: 'build',
      kind: 'function',
      file: 'src/build.ts',
      line: 10,
      lang: 'typescript',
      signature: 'export function build() {',
    },
  ];

  const edges = [
    {
      id: 'edge-build-widget',
      project,
      srcId: 'sym-build',
      srcName: 'build',
      dstId: 'sym-widget',
      dstName: 'Widget',
      relation: 'calls',
      confidence: 'INFERRED',
      score: 0.95,
      file: 'src/build.ts',
      line: 11,
    },
    {
      id: 'edge-build-external',
      project,
      srcId: 'sym-build',
      srcName: 'build',
      dstId: '',
      dstName: 'readFileSync',
      relation: 'calls',
      confidence: 'EXTRACTED',
      score: 1,
      file: 'src/build.ts',
      line: 12,
    },
  ];

  const files = [
    { project, path: 'src/widget.ts', hash: 'h-widget', scannedAt: Date.now() },
    { project, path: 'src/build.ts', hash: 'h-build', scannedAt: Date.now() },
  ];

  await store.upsertGraph({ symbols, edges, files });

  const found = await store.findSymbols({ project, name: 'Widget' });
  check('graph: symbol round-trips', found.length === 1 && found[0].kind === 'class', found.length);
  check(
    'graph: signature and location survive',
    found[0]?.file === 'src/widget.ts' && found[0]?.line === 3,
    `${found[0]?.file}:${found[0]?.line}`,
  );

  const inbound = await store.findEdges({ project, dstIds: ['sym-widget'] });
  check('graph: inbound edge found by target', inbound.length === 1, inbound.length);
  check(
    'graph: relation and confidence survive',
    inbound[0]?.relation === 'calls' && inbound[0]?.confidence === 'INFERRED',
    `${inbound[0]?.relation}/${inbound[0]?.confidence}`,
  );
  check('graph: inferred score survives', Math.abs((inbound[0]?.score ?? 0) - 0.95) < 1e-6);

  const outbound = await store.findEdges({ project, srcIds: ['sym-build'] });
  check('graph: both outbound edges found', outbound.length === 2, outbound.length);
  check(
    'graph: an unresolved target keeps its name with no id',
    outbound.some((edge) => edge.dstName === 'readFileSync' && edge.dstId === ''),
  );

  const hashes = await store.scannedFiles(project);
  check('graph: scan cache round-trips', hashes.length === 2, hashes.length);
  check(
    'graph: hash is stored per path',
    hashes.find((f) => f.path === 'src/build.ts')?.hash === 'h-build',
  );

  await store.upsertGraph({ symbols, edges, files });
  check(
    'graph: rescanning replaces rather than duplicating',
    (await store.findSymbols({ project, name: 'Widget' })).length === 1,
  );

  const dropped = await store.removeGraph(project, ['src/widget.ts']);
  check('graph: per-file removal reports what went', dropped === 1, dropped);
  check(
    'graph: the named file is gone',
    (await store.findSymbols({ project, name: 'Widget' })).length === 0,
  );
  check(
    'graph: other files are untouched',
    (await store.findSymbols({ project, name: 'build' })).length === 1,
  );
  check(
    'graph: its scan-cache entry went too',
    (await store.scannedFiles(project)).every((f) => f.path !== 'src/widget.ts'),
  );

  await store.removeGraph(project);
  check(
    'graph: a whole-project drop clears everything',
    (await store.findSymbols({ project })).length === 0 &&
      (await store.findEdges({ project })).length === 0 &&
      (await store.scannedFiles(project)).length === 0,
  );

  if (expected !== 'postgres') return;

  const bulk = Array.from({ length: 1200 }, (_, i) => ({
    id: `bulk-sym-${i}`,
    project,
    name: `bulk${i}`,
    kind: 'function',
    file: `src/bulk${i}.ts`,
    line: i + 1,
    lang: 'typescript',
    signature: `export function bulk${i}() {`,
  }));

  const connect = store.pool.connect.bind(store.pool);
  let statements = 0;
  store.pool.connect = async () => {
    const client = await connect();
    const query = client.query.bind(client);
    client.query = (...args) => {
      statements += 1;
      return query(...args);
    };
    return client;
  };
  await store.upsertGraph({ symbols: bulk, edges: [], files: [] });
  store.pool.connect = connect;

  check(
    'graph: symbols are written in batches, not one statement per row',
    statements < bulk.length / 10,
    `${statements} statements for ${bulk.length} symbols`,
  );
  check(
    'graph: every batched symbol landed',
    (await store.findSymbols({ project, limit: 5000 })).filter((s) => s.id.startsWith('bulk-sym-'))
      .length === bulk.length,
  );

  const duplicated = [
    { ...bulk[0], signature: 'first' },
    { ...bulk[0], signature: 'last' },
  ];
  let duplicateError = null;
  try {
    await store.upsertGraph({ symbols: duplicated, edges: [], files: [] });
  } catch (error) {
    duplicateError = error;
  }
  check(
    'graph: duplicate ids within one batch do not fail the write',
    duplicateError === null,
    duplicateError ? String(duplicateError.message).slice(0, 60) : '',
  );
  const [deduped] = (await store.findSymbols({ project, limit: 5000 })).filter(
    (s) => s.id === bulk[0].id,
  );
  check(
    'graph: the last duplicate wins, as the row-by-row writer did',
    deduped?.signature === 'last',
    deduped?.signature,
  );

  await store.removeGraph(project);
}
