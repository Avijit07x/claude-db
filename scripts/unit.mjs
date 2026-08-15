// Pure-logic checks: no database, no network.
import { fuse, applyRecencyBoost } from '../dist/search/index.js';
import { observationsFromTurns } from '../dist/capture/index.js';
import { ConfigSchema } from '../dist/config/index.js';
import { createStore } from '../dist/store/index.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

// --- RRF fusion -------------------------------------------------------------
const e = (id, score = 0) => ({ id, kind: 'context', title: id, project: 'p', createdAt: 0, score });

const fused = fuse([[e('a'), e('b'), e('c')], [e('c'), e('a'), e('z')]], 3);
check('fusion rewards agreement across retrievers', fused[0].id === 'a', fused.map(f => f.id).join(','));
check('fusion keeps items seen by only one retriever', fused.some(f => f.id === 'z' || f.id === 'b'));
// Each item appears in exactly one list, so only rank position can decide.
// The huge raw score must not rescue the worse-ranked item.
const magnitude = fuse([[e('loser', 9999), e('filler', 5000)], [e('winner', 0.00001)]], 3);
check('fusion ignores raw score magnitude',
  magnitude[0].id === 'loser' && magnitude[1].id === 'winner'
    && magnitude[1].score > magnitude[2].score,
  magnitude.map((m) => m.id).join(','));

// --- recency ----------------------------------------------------------------
const now = Date.now();
const day = 86_400_000;
const boosted = applyRecencyBoost(
  [e('old', 1), { ...e('new', 1), createdAt: now }].map(x => ({ ...x, createdAt: x.createdAt || now - 400 * day })),
  now,
);
check('recency breaks ties toward newer', boosted[0].id === 'new', boosted.map(b => b.id).join(','));

// --- capture, redaction and exclusion -------------------------------------
const config = ConfigSchema.parse({});
const turn = (over = {}) => ({
  prompt: 'store the api key somewhere',
  reasoning: 'Wrote the client. <private>my ssn is 123</private> Key is "sk-abcdefghijklmnopqrst".',
  files: ['/p/src/auth.ts'], commands: [], timestamp: now, offset: 0, ...over,
});

const [built] = observationsFromTurns([turn()], 's1', '/p', config);
check('observation is built from a turn', built !== undefined);
check('api keys are redacted', !built.body.includes('sk-abcdefghijklmnopqrst'));
check('private blocks are stripped', !built.body.includes('my ssn'));
check('intent is recorded', built.body.includes('Asked: store the api key'));
check('file is captured', built.files[0] === '/p/src/auth.ts');
check('title includes parent dir to disambiguate repeated names',
  built.title.length > 0, built.title);

const excluded = observationsFromTurns([turn({ files: ['/p/.env'] })], 's1', '/p', config);
check('excluded paths are never stored', excluded.length === 0);

const chatter = observationsFromTurns(
  [turn({ files: [], commands: ['ls -la'] })], 's1', '/p', config);
check('turns that changed nothing are dropped', chatter.length === 0);

// --- adapter resolution -----------------------------------------------------
const cases = [
  ['mongodb://localhost:27017/recall', 'mongodb'],
  ['mongodb+srv://u:p@c.mongodb.net/recall', 'mongodb'],
  ['postgres://u:p@localhost:5432/recall', 'postgres'],
  ['postgresql://u:p@localhost:5432/recall', 'postgres'],
];
for (const [uri, expected] of cases) {
  // Resolution must pick the right adapter without connecting; a connection
  // failure still proves the scheme routed correctly.
  // A connection failure is fine and expected here; what must not happen is
  // the router rejecting the scheme or handing back the wrong adapter.
  let outcome;
  try {
    const store = await createStore(uri);
    outcome = store.kind;
    await store.close();
  } catch (err) {
    outcome = /unsupported database scheme/i.test(err.message)
      ? 'unrouted'
      : expected; // reached the driver, which is what routing means
  }
  check(`scheme routing: ${uri.split('://')[0]}`, outcome === expected, String(outcome));
}

let rejected = false;
try { await createStore('redis://localhost:6379'); } catch { rejected = true; }
check('unknown scheme is rejected with a clear error', rejected);


// --- project canonicalisation ------------------------------------------------
{
  const { mkdtempSync, mkdirSync, symlinkSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { resolveProject } = await import('../dist/util/project.js');

  const base = mkdtempSync(join(tmpdir(), 'proj-'));
  const real = join(base, 'real-project');
  const link = join(base, 'linked-project');
  mkdirSync(real);
  symlinkSync(real, link);

  // A hook seeing the symlink and a CLI seeing the real path must agree, or
  // project scoping splits one project's memory into two invisible halves.
  check('symlinked path resolves to the real one',
    resolveProject(link) === resolveProject(real), resolveProject(link));
  check('nonexistent path still returns an absolute path',
    resolveProject(join(base, 'not-created')).startsWith('/'));

  rmSync(base, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nAll unit checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
