import { mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../lib/check.mjs';
import { newRepo } from '../lib/repo.mjs';
import {
  currentHashes,
  queryGraph,
  refreshGraph,
  saveScan,
  scanRepository,
} from '../../dist/graph/index.js';
import { createStore } from '../../dist/store/index.js';
import { staleFiles } from '../../dist/graph/query/stale.js';

const ALL = 100000;
const LATER_MS = 60_000;

async function openStore() {
  const dir = mkdtempSync(join(tmpdir(), 'graph-refresh-db-'));
  const store = await createStore(join(dir, 'memory.db'));
  await store.init();
  const done = async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { store, done };
}

async function snapshot(store, project) {
  const symbols = await store.findSymbols({ project, limit: ALL });
  const edges = await store.findEdges({ project, limit: ALL });
  return {
    symbols: symbols.map((s) => `${s.id}|${s.file}|${s.line}`).sort(),
    edges: edges.map((e) => `${e.id}|${e.dstId}|${e.confidence}|${e.line}`).sort(),
  };
}

const sameList = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);

async function storedAfterFullScan(repo) {
  const { store, done } = await openStore();
  await saveScan(
    store,
    repo,
    await scanRepository({ root: repo, project: repo, force: true }),
    true,
  );
  const state = await snapshot(store, repo);
  await done();
  return state;
}

async function staleness() {
  const { repo, git } = newRepo('graph-stale-');
  writeFileSync(join(repo, 'a.ts'), 'export function one() {\n  return 1;\n}\n');
  writeFileSync(join(repo, 'b.ts'), 'export function two() {\n  return 2;\n}\n');
  git('add', '-A');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=a', 'commit', '-qm', 'seed');
  const { store, done } = await openStore();
  try {
    const later = Date.now() + LATER_MS;
    const scan = await scanRepository({ root: repo, project: repo });
    await saveScan(store, repo, {
      ...scan,
      files: scan.files.map((f) => ({ ...f, scannedAt: later })),
    });
    const stale = async () =>
      staleFiles(repo, await store.scannedFiles(repo))
        .sort()
        .join(',');

    check('a fresh graph has no stale file', (await stale()) === '', await stale());
    const future = new Date(later + LATER_MS);
    utimesSync(join(repo, 'a.ts'), future, future);
    check(
      'a touched file with the same content is not stale',
      (await stale()) === '',
      await stale(),
    );
    writeFileSync(join(repo, 'a.ts'), 'export function one() {\n  return 11;\n}\n');
    utimesSync(join(repo, 'a.ts'), future, future);
    writeFileSync(join(repo, 'c.ts'), 'export function three() {}\n');
    unlinkSync(join(repo, 'b.ts'));
    check(
      'an edited, a new and a deleted file are all stale',
      (await stale()) === 'a.ts,b.ts,c.ts',
      await stale(),
    );
  } finally {
    await done();
    rmSync(repo, { recursive: true, force: true });
  }
}

async function upgrade() {
  const { repo, git } = newRepo('graph-upgrade-');
  writeFileSync(join(repo, 'a.ts'), 'export function one() {\n  return 1;\n}\n');
  git('add', '-A');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=a', 'commit', '-qm', 'seed');
  const { store, done } = await openStore();
  try {
    const later = Date.now() + LATER_MS;
    const scan = await scanRepository({ root: repo, project: repo });
    await saveScan(store, repo, {
      ...scan,
      files: scan.files.map((f) => ({ ...f, hash: `older-${f.hash}`, scannedAt: later })),
    });
    await refreshGraph(store, repo, repo);
    const stored = new Map((await store.scannedFiles(repo)).map((f) => [f.path, f.hash]));
    const now = currentHashes(repo);
    check(
      'a graph scanned under an older scanner key is rescanned even when no file changed',
      stored.size === 1 && stored.get('a.ts') === now.get('a.ts'),
      JSON.stringify([...stored]),
    );
    check(
      'and the next refresh has nothing to do',
      (await refreshGraph(store, repo, repo)).length === 0,
    );
  } finally {
    await done();
    rmSync(repo, { recursive: true, force: true });
  }
}

export default async function run() {
  await staleness();
  await upgrade();
  const { repo, git } = newRepo('graph-refresh-');
  writeFileSync(join(repo, 'a.ts'), 'export function foo() {\n  return 1;\n}\n');
  writeFileSync(
    join(repo, 'b.ts'),
    "import { foo, bar } from './a';\nexport function use() {\n  return foo() + bar();\n}\n",
  );
  writeFileSync(join(repo, 'c.ts'), 'export function other() {\n  return 3;\n}\n');
  git('add', '-A');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=a', 'commit', '-qm', 'seed');

  const { store, done } = await openStore();
  try {
    await saveScan(store, repo, await scanRepository({ root: repo, project: repo }));
    check(
      'nothing changed means no refresh work',
      (await refreshGraph(store, repo, repo)).length === 0,
    );

    writeFileSync(
      join(repo, 'a.ts'),
      'export function foo() {\n  return 1;\n}\nexport function bar() {\n  return 2;\n}\n',
    );
    const refreshed = await refreshGraph(store, repo, repo);
    check(
      'only the edited file is parsed again',
      refreshed.join(',') === 'a.ts',
      refreshed.join(','),
    );

    const bar = await queryGraph(store, repo, { mode: 'usages', symbol: 'bar', limit: 50 });
    const barId = bar.definitions[0]?.id;
    const fromB = bar.inbound.filter((edge) => edge.file === 'b.ts' && edge.dstId === barId);
    check(
      'a reference in an unchanged file is linked to a symbol the edit added',
      fromB.some((edge) => edge.relation === 'imports') &&
        fromB.some((edge) => edge.relation === 'calls'),
      bar.inbound
        .map((edge) => `${edge.file}:${edge.line}:${edge.relation}:${edge.dstId !== ''}`)
        .join(' '),
    );

    const refreshedState = await snapshot(store, repo);
    const fullState = await storedAfterFullScan(repo);
    check(
      'after a refresh the stored graph equals a full scan',
      sameList(refreshedState.symbols, fullState.symbols) &&
        sameList(refreshedState.edges, fullState.edges),
      `${refreshedState.edges.length} edges against ${fullState.edges.length}`,
    );

    const untouched = await scanRepository({
      root: repo,
      project: repo,
      stored: new Map((await store.scannedFiles(repo)).map((file) => [file.path, file.hash])),
    });
    check(
      'a scan with a warm cache parses nothing and rewrites nothing',
      untouched.changed.length === 0 && untouched.rewrite.length === 0 && untouched.skipped === 3,
      `parsed ${untouched.changed.length}, rewrite ${untouched.rewrite.length}`,
    );

    unlinkSync(join(repo, 'a.ts'));
    await refreshGraph(store, repo, repo);
    const gone = await queryGraph(store, repo, { mode: 'usages', symbol: 'bar', limit: 50 });
    const afterDelete = await snapshot(store, repo);
    check(
      'a deleted file loses its symbols, and references to it lose their target',
      gone.definitions.length === 0 &&
        !afterDelete.symbols.some((symbol) => symbol.includes('|a.ts|')) &&
        sameList(afterDelete.edges, (await storedAfterFullScan(repo)).edges),
      afterDelete.symbols.join(' '),
    );
    const leftover = staleFiles(repo, await store.scannedFiles(repo));
    check(
      'a deleted tracked file is not stale again once the graph dropped it',
      leftover.length === 0,
      leftover.join(','),
    );
    check(
      'an unrelated file keeps its rows',
      afterDelete.symbols.some((symbol) => symbol.includes('|c.ts|')),
    );
  } finally {
    await done();
    rmSync(repo, { recursive: true, force: true });
  }
}
