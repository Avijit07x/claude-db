import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../lib/check.mjs';
import { newRepo } from '../lib/repo.mjs';
import { createStore } from '../../dist/store/index.js';
import { scanRepository, queryGraph, refreshGraph, formatGraph } from '../../dist/graph/index.js';

export default async function run() {
  const { repo, git } = newRepo('graphq-');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'a.ts'), 'export function alpha() {\n  return beta();\n}\n');
  writeFileSync(join(repo, 'src', 'b.ts'), 'export function beta() {\n  return gamma();\n}\n');
  writeFileSync(join(repo, 'src', 'c.ts'), 'export function gamma() {\n  return 1;\n}\n');
  git('add', '-A');
  git('commit', '-qm', 'seed');

  const dir = mkdtempSync(join(tmpdir(), 'graphq-db-'));
  const store = await createStore(join(dir, 'memory.db'));
  await store.init();

  const scan = scanRepository({ root: repo, project: repo, known: new Map() });
  await store.upsertGraph({ symbols: scan.symbols, edges: scan.edges, files: scan.files });

  const usages = await queryGraph(store, repo, { mode: 'usages', symbol: 'beta', limit: 50 });
  check('query finds the definition', usages.definitions[0]?.file === 'src/b.ts');
  check(
    'query lists what references it',
    usages.inbound.some((e) => e.srcName === 'alpha'),
    usages.inbound.map((e) => e.srcName).join(','),
  );

  const explain = await queryGraph(store, repo, { mode: 'explain', symbol: 'beta', limit: 50 });
  check(
    'explain also lists what it reaches',
    explain.outbound.some((e) => e.dstName === 'gamma'),
    explain.outbound.map((e) => e.dstName).join(','),
  );

  const path = await queryGraph(store, repo, {
    mode: 'path',
    symbol: 'alpha',
    target: 'gamma',
    limit: 50,
  });
  check(
    'path traces the real chain',
    path.path.join('>') === 'alpha>beta>gamma',
    path.path.join('>'),
  );

  const none = await queryGraph(store, repo, {
    mode: 'path',
    symbol: 'gamma',
    target: 'alpha',
    limit: 50,
  });
  check('a route that does not exist is reported as none', none.path.length === 0);

  const missing = await queryGraph(store, repo, { mode: 'usages', symbol: 'nowhere', limit: 50 });
  check('an unknown symbol reports empty rather than inventing', missing.empty);
  check('the empty message names the symbol', formatGraph(missing, repo).includes('nowhere'));

  writeFileSync(
    join(repo, 'src', 'b.ts'),
    '\n\n\nexport function beta() {\n  return gamma();\n}\n',
  );
  const refreshed = await refreshGraph(store, repo, repo);
  check('a changed file is detected', refreshed.includes('src/b.ts'), refreshed.join(','));

  const after = await queryGraph(store, repo, { mode: 'usages', symbol: 'beta', limit: 50 });
  check(
    'the moved definition reports its new line, never the old one',
    after.definitions[0]?.line === 4,
    String(after.definitions[0]?.line),
  );

  rmSync(join(repo, 'src', 'c.ts'));
  await refreshGraph(store, repo, repo);
  const gone = await queryGraph(store, repo, { mode: 'usages', symbol: 'gamma', limit: 50 });
  check('a deleted file leaves no orphan definition', gone.definitions.length === 0);

  await store.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
}
