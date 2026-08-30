import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { check } from '../lib/check.mjs';
import { extractFile, symbolId } from '../../dist/graph/scan/extract.js';
import { resolveEdges } from '../../dist/graph/scan/resolve.js';
import { languageFor } from '../../dist/graph/languages/index.js';
import { createStore } from '../../dist/store/index.js';
import { queryGraph } from '../../dist/graph/query/lookup.js';
import { readTranscript } from '../../dist/capture/index.js';
import { renderPromptContext } from '../../dist/hooks/relevance.js';
import { symbolsGreppedIn } from '../../dist/hooks/grep-symbols.js';
import { redact } from '../../dist/capture/turn-extractor.js';
import { findUsages } from '../../dist/usages/find.js';

const ts = languageFor('a.ts');
const parse = (path, source, spec = ts) => extractFile({ path, spec, source, hash: 'h' }, '/p');

export default async function run() {
  {
    const src = 'class A { run() { return 1; } }\nclass B { run() { return 2; } }\n';
    const x = parse('src/x.ts', src);
    const byId = new Map(x.symbols.map((s) => [s.id, s]));
    const edges = resolveEdges('/p', x.symbols, x.references);
    const bDefines = edges.find(
      (e) => e.relation === 'defines' && e.srcName === 'B' && e.dstName === 'run',
    );
    check(
      'a defines edge points at the declaration it came from, not a same-named sibling',
      byId.get(bDefines?.dstId)?.line === 2,
      `line ${byId.get(bDefines?.dstId)?.line}`,
    );
  }

  {
    const c = parse('c.ts', 'function f(){ const root = parser.root(); return root; }\n');
    const ids = resolveEdges('/p', c.symbols, c.references).map((e) => e.id);
    check('two relations on one line get separate edge ids', new Set(ids).size === ids.length);
  }

  {
    const a = parse('a.ts', 'export function trim(s) { return s; }\n');
    const b = parse('b.ts', 'export function outer(value) { return trim(value.trim()); }\n');
    const edges = resolveEdges(
      '/p',
      [...a.symbols, ...b.symbols],
      [...a.references, ...b.references],
    );
    const names = edges
      .filter((e) => e.file === 'b.ts' && e.relation === 'calls')
      .map((e) => e.dstName);
    check(
      'a direct call survives beside a member call on the same line',
      names.includes('trim') && names.includes('value.trim'),
      names.join(','),
    );
  }

  {
    const r = parse(
      'h.ts',
      'interface S {}\ninterface T {}\nclass C extends B implements S, T {}\n',
    );
    const rel = r.references.filter((x) => x.relation === 'implements').map((x) => x.name);
    check(
      'implements produces an edge per named interface',
      rel.includes('S') && rel.includes('T'),
      rel.join(','),
    );
    const js = parse('d.js', 'class Dog extends Animal {}\n', languageFor('a.js'));
    check(
      'a plain .js class still records what it extends',
      js.references.some((x) => x.relation === 'extends' && x.name === 'Animal'),
    );
  }

  {
    const dir = mkdtempSync(join(tmpdir(), 'rf-'));
    const store = await createStore(join(dir, 'g.db'));
    await store.init();
    const a = parse('src/a.ts', 'export class Repo { save() { return 1; } }\n');
    const b = parse('src/b.ts', 'export function main(repo) { return repo.save(); }\n');
    const symbols = [...a.symbols, ...b.symbols];
    await store.upsertGraph({
      symbols,
      edges: resolveEdges('/p', symbols, [...a.references, ...b.references]),
      files: [],
    });
    const answer = await queryGraph(store, '/p', { symbol: 'save', mode: 'usages', limit: 20 });
    check(
      'usages reports the real caller of a method, not just its class',
      answer.inbound.some((e) => e.file === 'src/b.ts'),
      answer.inbound.map((e) => `${e.srcName}->${e.dstName}`).join(','),
    );
    await store.close?.();
    rmSync(dir, { recursive: true, force: true });
  }

  {
    const dir = mkdtempSync(join(tmpdir(), 'ls-'));
    const store = await createStore(join(dir, 'l.db'));
    await store.init();
    const mk = (id, createdAt) => ({
      id,
      sessionId: 's',
      project: '/p',
      kind: 'context',
      title: id,
      body: 'b',
      files: [],
      tags: [],
      createdAt,
    });
    await store.insertObservations([
      mk('t1', 50),
      mk('t2', 75),
      mk('t3', 100),
      mk('t4', 100),
      mk('t5', 100),
      mk('t6', 200),
    ]);

    const seen = [];
    let after = 0;
    let afterId;
    for (;;) {
      const batch = await store.list({
        project: '/p',
        after,
        ...(afterId ? { afterId } : {}),
        limit: 4,
      });
      if (batch.length === 0) break;
      seen.push(...batch.map((o) => o.id));
      const last = batch[batch.length - 1];
      after = last.createdAt;
      afterId = last.id;
      if (batch.length < 4) break;
    }
    check(
      'a cursor walk over tied timestamps visits every row',
      new Set(seen).size === 6,
      seen.join(','),
    );
    const newest = await store.list({ project: '/p', limit: 2, newest: true });
    check(
      'newest returns the newest, not the oldest',
      newest[0]?.id === 't6',
      newest.map((o) => o.id).join(','),
    );
    await store.close?.();
    rmSync(dir, { recursive: true, force: true });
  }

  {
    const dir = mkdtempSync(join(tmpdir(), 'tr-'));
    const path = join(dir, 's.jsonl');
    const done = JSON.stringify({
      type: 'assistant',
      timestamp: new Date().toISOString(),
      message: { content: [{ type: 'text', text: 'x' }] },
    });
    writeFileSync(path, `${done}\n{"type":"user","message":{"content":"half writ`);
    const { turns, nextOffset } = readTranscript(path, 0);
    check(
      'the cursor never advances past a half-written line',
      turns.length === 0 && nextOffset === done.length + 1,
      `turns ${turns.length}, next ${nextOffset}`,
    );
    rmSync(dir, { recursive: true, force: true });
  }

  {
    const entries = Array.from({ length: 4 }, (_, i) => ({
      id: `0000000${i}-aaaa-bbbb-cccc-dddddddddddd`,
      kind: 'context',
      title: `t${i} ${'x'.repeat(70)}`,
      snippet: 'y'.repeat(100),
      createdAt: Date.now(),
    }));
    const emitted = [];
    const block = renderPromptContext(entries, 250, [], 900, emitted);
    check(
      'only the entries actually rendered are reported as shown',
      block !== null &&
        emitted.length < entries.length &&
        emitted.every((id) => block.includes(id.slice(0, 8))),
      `${emitted.length} of ${entries.length}`,
    );
  }

  {
    check(
      'a recursive grep long-flag is still caught',
      symbolsGreppedIn('grep --recursive myHandler src').length === 1,
    );
    check(
      'an inverted grep is still ignored',
      symbolsGreppedIn('grep -v myHandler src').length === 0,
    );
    check(
      '--invert-match is ignored too',
      symbolsGreppedIn('grep --invert-match myHandler src').length === 0,
    );
  }

  check(
    'an unclosed private tag is still redacted',
    !redact('before <private> sk-secret-value').includes('sk-secret-value'),
  );

  {
    const cast = parse('cast.ts', 'function f(o){ return (o as Widget).run(); }\n');
    const names = cast.references.map((r) => `${r.relation}:${r.name}`);
    check(
      'a cast in a call does not fabricate edges for every identifier in it',
      !names.includes('calls:o') && !names.includes('calls:Widget'),
      names.join(','),
    );
  }

  {
    const dir = mkdtempSync(join(tmpdir(), 'de-'));
    const store = await createStore(join(dir, 'e.db'));
    await store.init();
    const a = parse('src/a.ts', 'export class Repo { save() { return 1; } }\n');
    const b = parse('src/b.ts', 'export function main(repo) { return repo.save(); }\n');
    const symbols = [...a.symbols, ...b.symbols];
    await store.upsertGraph({
      symbols,
      edges: resolveEdges('/p', symbols, [...a.references, ...b.references]),
      files: [],
    });
    const byName = await store.findEdges({ project: '/p', dstName: 'save', limit: 50 });
    check(
      'findEdges can filter by destination name, including a member call',
      byName.length > 0 && byName.every((e) => e.dstName === 'save' || e.dstName.endsWith('.save')),
      byName.map((e) => e.dstName).join(','),
    );
    await store.close?.();
    rmSync(dir, { recursive: true, force: true });
  }

  {
    const dir = mkdtempSync(join(tmpdir(), 'cl-'));
    const store = await createStore(join(dir, 'c.db'));
    await store.init();
    const mk = (id, createdAt) => ({
      id,
      sessionId: 's',
      project: '/p',
      kind: 'context',
      title: id,
      body: 'b',
      files: [],
      tags: [],
      createdAt,
      status: 'open',
    });
    check(
      'a row with no usable timestamp is still reachable from an unfiltered cursor',
      (
        await (async () => {
          await store.insertObservations([mk('z0', 0), mk('z1', 10)]);
          return store.list({ project: '/p', limit: 10 });
        })()
      ).length === 2,
    );
    await store.close?.();
    rmSync(dir, { recursive: true, force: true });
  }

  {
    const dir = mkdtempSync(join(tmpdir(), 'ts-'));
    const path = join(dir, 't.jsonl');
    const stamped = JSON.stringify({
      type: 'user',
      timestamp: '2026-01-02T03:04:05.000Z',
      message: { content: 'first prompt here' },
    });
    const unstamped = JSON.stringify({ type: 'user', message: { content: 'second prompt here' } });
    writeFileSync(path, `${stamped}\n${unstamped}\n`);
    const { turns } = readTranscript(path, 0);
    check(
      'a turn with no timestamp inherits the last known one rather than 1970',
      turns.length === 2 && turns[1].timestamp === Date.parse('2026-01-02T03:04:05.000Z'),
      turns.map((t) => t.timestamp).join(','),
    );
    rmSync(dir, { recursive: true, force: true });
  }

  {
    const dir = mkdtempSync(join(tmpdir(), 'fu-'));
    execFileSync('git', ['init', '-q', dir]);
    writeFileSync(
      join(dir, 'f.ts'),
      'const a = 1;\nconst b = 2;\nfunction target() {}\nconst target2 = target;\nconst c = 3;\n',
    );
    const found = findUsages({ symbol: 'target', regex: false, context: 1, limit: 100, path: dir });
    check(
      'adjacent matches are both reported as matches',
      found.matches.filter((m) => m.isMatch).length === found.total,
      `${found.matches.filter((m) => m.isMatch).length} vs total ${found.total}`,
    );
    rmSync(dir, { recursive: true, force: true });
  }
}
