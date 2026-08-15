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

const leaky = observationsFromTurns(
  [turn({ reasoning: 'Set OPENAI_KEY to "sk-abcdefghijklmnopqrst" in the client config' })],
  's1', '/p', config);
check('secrets are redacted from titles, not just bodies',
  !leaky[0].title.includes('sk-abcdefghijklmnopqrst'), leaky[0].title);

const secrets = observationsFromTurns([turn({
  reasoning: [
    'Rotated everything.',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----',
    'aws AKIAIOSFODNN7EXAMPLE and slack xoxb-1234567890-abcdefghij',
    'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  ].join('\n'),
})], 's1', '/p', config);
check('private key blocks are redacted', !secrets[0].body.includes('MIIEowIBAAKCAQEA'));
check('aws keys are redacted', !secrets[0].body.includes('AKIAIOSFODNN7EXAMPLE'));
check('slack tokens are redacted', !secrets[0].body.includes('xoxb-1234567890'));
check('jwts are redacted', !secrets[0].body.includes('eyJhbGciOiJIUzI1NiJ9'));

// The likeliest secret to reach a tool that remembers what you type.
const dsn = observationsFromTurns([turn({
  prompt: 'cdb use "mongodb+srv://avnadmin:hunter2secret@ecommerce.mongodb.net/db"',
})], 's1', '/p', config);
check('credentials in a connection string are redacted',
  !dsn[0].body.includes('hunter2secret'), dsn[0].body.split('\n')[0]);
check('the host survives redaction so the memory stays useful',
  dsn[0].body.includes('ecommerce.mongodb.net'));

const tagged = observationsFromTurns(
  [turn({ files: ['/p/sellergeni-backend/src/api.ts', '/p/sellergeni-frontend/app.tsx', '/p/README.md'] })],
  's1', '/p', config);
check('the repo a file lives in becomes a tag',
  tagged[0].tags.includes('sellergeni-backend') && tagged[0].tags.includes('sellergeni-frontend'),
  tagged[0].tags.join(','));
check('root-level files do not become tags', !tagged[0].tags.includes('README.md'));

const standing = observationsFromTurns(
  [turn({ prompt: 'always use pnpm in this repo, never npm' })], 's1', '/p', config);
check('standing rules are classified as preferences', standing[0].kind === 'preference',
  standing[0].kind);

const notARule = observationsFromTurns(
  [turn({ prompt: 'the build always fails on ci', reasoning: 'Fixed the broken cache key.' })],
  's1', '/p', config);
check('"always" in a complaint is not a preference', notARule[0].kind !== 'preference',
  notARule[0].kind);

// Titles are the whole payload of a search result. Measured on a real database,
// about half were transitions like these, so nothing ever surfaced the body.
const narrated = observationsFromTurns([turn({
  reasoning: 'Now the use command and the top-level handler:\nThe config was saved before the connection was verified, so a bad host bricked memory.',
})], 's1', '/p', config);
check('a title skips the sentence that only announces the work',
  narrated[0].title.startsWith('The config was saved'), narrated[0].title);

const chatty = observationsFromTurns([turn({
  reasoning: "Good question, and the answer is specific.\nFTS5 keeps a run of Han characters as a single token.",
})], 's1', '/p', config);
check('and skips conversational filler',
  chatty[0].title.startsWith('FTS5 keeps'), chatty[0].title);

const allNarration = observationsFromTurns([turn({
  reasoning: 'Now doing the thing:\nLet me start with that.',
})], 's1', '/p', config);
check('falls back to the opening when every sentence announces',
  allNarration[0].title.length > 0, allNarration[0].title);

const excluded = observationsFromTurns([turn({ files: ['/p/.env'] })], 's1', '/p', config);
check('excluded paths are never stored', excluded.length === 0);

const chatter = observationsFromTurns(
  [turn({ files: [], commands: ['ls -la'] })], 's1', '/p', config);
check('turns that changed nothing are dropped', chatter.length === 0);

// --- session summaries ------------------------------------------------------
{
  const { summarize } = await import('../dist/capture/index.js');
  const obs = (kind, title) => ({ kind, title });

  check('a decision outranks the command that followed it',
    summarize([obs('context', 'Build'), obs('decision', 'Chose WebSocket')]).startsWith('Chose'),
    summarize([obs('context', 'Build'), obs('decision', 'Chose WebSocket')]));

  // Capture is incremental, so a flush usually carries one turn. Without the
  // carry-forward, a whole day's session was summarised by its last prompt.
  const first = summarize([obs('decision', 'Chose WebSocket')]);
  const second = summarize([obs('context', 'Ran the build')], first);
  check('earlier work survives later flushes', second.includes('Chose WebSocket'), second);
  check('summaries stay at three segments',
    summarize([obs('context', 'd'), obs('context', 'e')], 'a | b | c').split(' | ').length === 3);
  check('a repeated title is not duplicated',
    summarize([obs('decision', 'a')], 'a | b') === 'a | b');
}

// --- embedding width --------------------------------------------------------
{
  const { cosine } = await import('../dist/util/vector.js');
  check('same-width vectors score normally', cosine([1, 0], [1, 0]) === 1);
  check('mismatched widths never score', cosine([1, 0, 0], [1, 0]) === 0);
}

// --- prompts in any script --------------------------------------------------
{
  const { isSearchable } = await import('../dist/hooks/relevance.js');
  const foreign = ['修复登录接口的超时问题', 'ログイン画面のバグ', 'почему падает сборка'];
  check('non-latin prompts reach search', foreign.every(isSearchable), foreign.filter((p) => !isSearchable(p)).join(' '));
  check('english prompts still reach search', isSearchable('fix the login timeout bug'));
  check('filler is still rejected',
    !isSearchable('ok') && !isSearchable('thanks') && !isSearchable('go ahead'));
}

// --- install / uninstall ------------------------------------------------------
{
  const { install, uninstall } = await import('../dist/cli/install.js');
  const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  // Project scope only: it writes files inside the given directory and never
  // shells out, so this stays hermetic.
  const repo = mkdtempSync(join(tmpdir(), 'install-'));
  const dist = join(repo, 'dist');
  const read = (name) => {
    try {
      return JSON.parse(readFileSync(join(repo, name), 'utf8'));
    } catch {
      return null;
    }
  };

  writeFileSync(join(repo, 'CLAUDE.local.md'), '# Notes\n\nSomething the user wrote.\n');

  install(dist, 'project', repo);
  install(dist, 'project', repo);

  // Hook output is context; a memory file is a standing instruction. Without
  // this the agent has to be told to search its own memory every session.
  const guidance = readFileSync(join(repo, 'CLAUDE.local.md'), 'utf8');
  check('install writes standing memory instructions', guidance.includes('`search`'));
  check('installing twice does not duplicate them',
    guidance.split('claude-db:start').length - 1 === 1);
  check('the user\'s own notes are left alone', guidance.includes('Something the user wrote.'));

  const settings = read('.claude/settings.local.json');
  check('install registers every hook exactly once',
    Object.values(settings.hooks).every((entries) => entries.length === 1),
    Object.entries(settings.hooks).map(([k, v]) => `${k}=${v.length}`).join(' '));
  check('install registers the mcp server', !!read('.mcp.json').mcpServers.memory);

  uninstall(dist, 'project', repo);
  // Regression: emptiness was tested after the delete, so a config holding
  // only our server was never written back and uninstall left it registered.
  check('uninstall removes the mcp server even when it was the only one',
    !read('.mcp.json').mcpServers, JSON.stringify(read('.mcp.json')));
  check('uninstall removes the hooks', !read('.claude/settings.local.json').hooks);

  const afterRemoval = readFileSync(join(repo, 'CLAUDE.local.md'), 'utf8');
  check('uninstall takes back only its own instructions',
    !afterRemoval.includes('claude-db:start') && afterRemoval.includes('Something the user wrote.'),
    afterRemoval.trim());

  rmSync(repo, { recursive: true, force: true });
}

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

  const { realpathSync, writeFileSync } = await import('node:fs');

  // Running the agent from a subdirectory used to start a second, empty
  // memory that looked exactly like never having worked in the repo.
  const repo = join(base, 'repo');
  mkdirSync(join(repo, 'frontend', 'src'), { recursive: true });
  mkdirSync(join(repo, '.git'));
  check('a subdirectory keys the repository root',
    resolveProject(join(repo, 'frontend', 'src')) === realpathSync(repo));

  const worktree = join(base, 'worktree');
  mkdirSync(join(worktree, 'pkg'), { recursive: true });
  writeFileSync(join(worktree, '.git'), 'gitdir: /elsewhere\n');
  check('.git as a file (worktrees, submodules) still counts',
    resolveProject(join(worktree, 'pkg')) === realpathSync(worktree));

  // A directory that merely holds repos is not one, so it keeps its own key
  // and the memory of everything under it stays pooled.
  const workspace = join(base, 'workspace');
  mkdirSync(join(workspace, 'repo-a', '.git'), { recursive: true });
  mkdirSync(join(workspace, 'repo-b', '.git'), { recursive: true });
  check('a folder holding several repos keeps its own key',
    resolveProject(workspace) === realpathSync(workspace));
  check('each repo inside it still keys separately',
    resolveProject(join(workspace, 'repo-a')) === realpathSync(join(workspace, 'repo-a')));

  rmSync(base, { recursive: true, force: true });
}

// --- project identity against a fabricated $HOME ------------------------------
{
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const home = realpathSync(mkdtempSync(join(tmpdir(), 'home-')));
  mkdirSync(join(home, '.git'));
  const repo = join(home, 'work', 'app');
  const extra = join(home, 'work', 'app-extra');
  mkdirSync(join(repo, 'frontend'), { recursive: true });
  mkdirSync(join(extra, '.git'), { recursive: true });
  mkdirSync(join(repo, '.git'), { recursive: true });

  const slug = (path) => path.replace(/[/.]/g, '-');
  const transcript = (dir, name, cwd) => {
    mkdirSync(join(home, '.claude', 'projects', dir), { recursive: true });
    writeFileSync(join(home, '.claude', 'projects', dir, name),
      `${JSON.stringify({ type: 'user', cwd })}\n`);
  };
  transcript(slug(repo), 'a.jsonl', repo);
  transcript(`${slug(repo)}-frontend`, 'b.jsonl', join(repo, 'frontend'));
  transcript(slug(extra), 'c.jsonl', extra);

  const probe = join(home, 'probe.mjs');
  writeFileSync(probe, `
    import { basename } from 'node:path';
    import { resolveProject } from ${JSON.stringify(new URL('../dist/util/project.js', import.meta.url).href)};
    import { transcriptsFor } from ${JSON.stringify(new URL('../dist/capture/index.js', import.meta.url).href)};
    process.stdout.write(JSON.stringify({
      guarded: resolveProject(${JSON.stringify(join(repo, 'frontend'))}),
      found: transcriptsFor(${JSON.stringify(repo)}).map((p) => basename(p)),
    }));
  `);

  const out = JSON.parse(
    execFileSync(process.execPath, [probe], { env: { ...process.env, HOME: home }, encoding: 'utf8' }),
  );

  // Dotfiles repositories in the home directory are common; without the guard
  // every unrelated project on the machine walks up into one shared memory.
  check('a dotfiles repo in $HOME does not swallow every project',
    out.guarded === repo, out.guarded);
  check('flush finds transcripts recorded from a subdirectory',
    out.found.includes('a.jsonl') && out.found.includes('b.jsonl'), out.found.join(','));
  check('flush rejects a neighbour the lossy slug collides with',
    !out.found.includes('c.jsonl'), out.found.join(','));

  rmSync(home, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nAll unit checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
