import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore } from '../dist/store/index.js';
import { SearchService } from '../dist/search/index.js';
import { BuiltinEmbedder } from '../dist/embed/index.js';

const V = Array.from({ length: 4000 }, (_, i) => `term${i}`);
const z = () => V[Math.min(3999, Math.floor(Math.abs(Math.tan(Math.random() * 1.5)) * 40))];
const emb = new BuiltinEmbedder();
const kinds = ['decision', 'pattern', 'bugfix', 'context', 'deadend', 'preference'];

console.log('obs/project is what matters: vector scan is O(observations in scope)\n');
console.log('total    projects  per-proj   db     keyword   vector   hybrid');
console.log('-'.repeat(68));

for (const [N, P] of [
  [10000, 10],
  [50000, 20],
  [150000, 30],
  [300000, 30],
]) {
  const dir = mkdtempSync(join(tmpdir(), 'c-'));
  const dbp = join(dir, 'c.db');
  const store = await createStore(dbp);
  await store.init();
  const search = new SearchService(store, emb);
  for (let b = 0; b < N; b += 5000) {
    const batch = [];
    for (let i = 0; i < Math.min(5000, N - b); i++) {
      const title = `${z()} ${z()} ${z()}`;
      const body = Array.from({ length: 30 }, z).join(' ');
      const [e] = await emb.embed([`${title} ${body}`]);
      batch.push({
        id: randomUUID(),
        sessionId: `s${(b + i) % 999}`,
        project: `/p/a${(b + i) % P}`,
        kind: kinds[(b + i) % 6],
        title,
        body,
        files: [],
        tags: [z()],
        createdAt: Date.now() - Math.floor(Math.random() * 365 * 864e5),
        embedding: e,
      });
    }
    await store.insertObservations(batch);
  }

  const proj = '/p/a3';
  const bench = async (fn, runs = 20) => {
    await fn();
    const ts = [];
    for (let i = 0; i < runs; i++) {
      const s = performance.now();
      await fn();
      ts.push(performance.now() - s);
    }
    ts.sort((a, b) => a - b);
    return ts[Math.floor(runs * 0.5)];
  };

  const kw = await bench(() =>
    store.searchKeyword({ text: `${z()} ${z()}`, project: proj, limit: 10 }),
  );
  const vec = await bench(async () => {
    const [v] = await emb.embed([`${z()} ${z()}`]);
    return store.searchVector(v, { text: '', project: proj, limit: 10 });
  });
  const hy = await bench(() => search.search({ text: `${z()} ${z()}`, project: proj, limit: 10 }));

  console.log(
    `${String(N).padStart(7)}  ${String(P).padStart(8)}  ${String(Math.round(N / P)).padStart(8)}  ${(statSync(dbp).size / 1e6).toFixed(0).padStart(4)}MB  ${kw.toFixed(1).padStart(6)}ms ${vec.toFixed(1).padStart(7)}ms ${hy.toFixed(1).padStart(7)}ms`,
  );
  await store.close();
  rmSync(dir, { recursive: true, force: true });
}
