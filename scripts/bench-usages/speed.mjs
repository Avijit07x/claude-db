import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { scanRepository } from '../../dist/graph/scan/index.js';
import { refreshGraph } from '../../dist/graph/query/refresh.js';
import { createStore } from '../../dist/store/index.js';

const DIST = fileURLToPath(new URL('../../dist/', import.meta.url));
const CLI = join(DIST, 'cli', 'index.js');
const HOOK = join(DIST, 'hooks', 'prefer-usages.js');
const HOOK_SYMBOLS = 5;
const STALE_HASH = 'stale';

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? null : Math.round(sorted[Math.floor(sorted.length / 2)]);
}

const turn = () => new Promise((resolve) => setImmediate(resolve));

async function timed(work) {
  const started = performance.now();
  const value = await work();
  return { value, ms: performance.now() - started };
}

export async function scanTimes(root, runs) {
  let result;
  const times = [];
  for (let run = 0; run < runs; run += 1) {
    const scan = await timed(() =>
      scanRepository({ root, project: root, stored: new Map(), force: true }),
    );
    result = scan.value;
    times.push(scan.ms);
    await turn();
  }
  return { result, scanMs: median(times) };
}

const editedFile = (result) => result.files[Math.floor(result.files.length / 2)]?.path;

export async function refreshTimes(root, result, runs) {
  const home = mkdtempSync(join(tmpdir(), 'bench-refresh-'));
  const store = await createStore(join(home, 'graph.db'));
  try {
    await store.init();
    await store.upsertGraph({ symbols: result.symbols, edges: result.edges, files: result.files });
    const path = editedFile(result);
    if (!path) return null;
    const times = [];
    for (let run = 0; run < runs; run += 1) {
      await store.upsertGraph({
        symbols: [],
        edges: [],
        files: [{ project: root, path, hash: STALE_HASH, scannedAt: 0 }],
      });
      const started = performance.now();
      await refreshGraph(store, root, root);
      times.push(performance.now() - started);
      await turn();
    }
    return median(times);
  } finally {
    await store.close();
    rmSync(home, { recursive: true, force: true });
  }
}

export async function hookTimes(root, names, runs) {
  const home = mkdtempSync(join(tmpdir(), 'bench-hook-'));
  const env = {
    ...process.env,
    HOME: home,
    CLAUDE_DB_URL: join(home, 'db.sqlite'),
    CLAUDE_DB_USAGES_HOOK: 'deny',
  };
  try {
    execFileSync(process.execPath, [CLI, 'scan', '--force'], { cwd: root, env, stdio: 'ignore' });
    const times = [];
    for (const name of names.slice(0, HOOK_SYMBOLS)) {
      const input = JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Grep',
        tool_input: { pattern: name },
        cwd: root,
      });
      for (let run = 0; run < runs; run += 1) {
        const answer = await timed(() =>
          execFileSync(process.execPath, [HOOK], { input, env, cwd: root }),
        );
        times.push(answer.ms);
      }
    }
    return median(times);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
