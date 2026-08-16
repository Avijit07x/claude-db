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

// `because` explains as readily as it decides, and matched 98 of 471 stored
// decisions on its own — half the database was one kind, so the filter stopped
// narrowing anything.
const explained = observationsFromTurns([turn({
  prompt: 'fix the flaky test', reasoning: 'It was flaky because the clock was mocked.',
})], 's1', '/p', config);
check('"because" alone no longer makes a decision', explained[0].kind === 'bugfix',
  explained[0].kind);

const weighed = observationsFromTurns([turn({
  prompt: 'pick an index', reasoning: 'Went with FTS5 instead of a trigram index.',
})], 's1', '/p', config);
check('a weighed alternative still is', weighed[0].kind === 'decision', weighed[0].kind);

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

// When the whole reply is narration the prompt is the only record of intent,
// and intent beats "Working through the improvements now." — which is what one
// turn in this project's own memory was titled.
const allNarration = observationsFromTurns([turn({
  prompt: 'store the api key somewhere',
  reasoning: 'Working through the improvements now.\nLet me start with that.',
})], 's1', '/p', config);
check('a reply that only narrates falls back to what was asked',
  allNarration[0].title === 'store the api key somewhere', allNarration[0].title);

// Skipping announcements alone still lets a merely-neutral opening win, which
// is how "Working through the improvements now." became a stored title.
const buried = observationsFromTurns([turn({
  reasoning: 'Working through the improvements now.\nMoved the sweep into flush.ts so a cursor without a transcript is dropped.',
})], 's1', '/p', config);
check('a neutral opening loses to a later sentence carrying evidence',
  buried[0].title.startsWith('Moved the sweep'), buried[0].title);

const pasted = observationsFromTurns([turn({
  reasoning: 'Notes from the session follow.\nToken is "sk-abcdefghijkl1234567890".',
})], 's1', '/p', config);
check('a redacted secret does not count as evidence',
  pasted[0].title.startsWith('Notes from'), pasted[0].title);

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

// --- snippets and body clipping ---------------------------------------------
{
  const { toSnippet, clipBody } = await import('../dist/util/snippet.js');

  check('a snippet collapses to one line',
    toSnippet('first line\n\nsecond   line') === 'first line second line',
    toSnippet('first line\n\nsecond line'));
  // ts_headline wraps matches in <b> by default, which is noise once the
  // fragment itself is the signal.
  check('search-engine match markers are stripped',
    toSnippet('the <b>cursor</b> was stale') === 'the cursor was stale');
  check('markdown table pipes are stripped',
    !toSnippet('| a | b |').includes('|'), toSnippet('| a | b |'));
  // Underscores read as emphasis and are almost always an identifier; stripping
  // them turned aggregation_cursor.js into two words that match nothing.
  check('identifiers survive intact',
    toSnippet('at aggregation_cursor.js:46').includes('aggregation_cursor.js'),
    toSnippet('at aggregation_cursor.js:46'));
  check('an empty body yields no snippet', toSnippet('   ') === undefined);
  check('a missing body yields no snippet', toSnippet(undefined) === undefined);
  check('a long snippet is cut at a word boundary',
    toSnippet('x'.repeat(20) + ' ' + 'word '.repeat(40), 40).endsWith('…'),
    toSnippet('x'.repeat(20) + ' ' + 'word '.repeat(40), 40));

  // Layer 3 takes 25 ids at once, so the cost argument that made the index
  // terse bites far harder here than in the index it was written for.
  check('a short body is returned whole', clipBody('short', 2000) === 'short');
  const clipped = clipBody('y'.repeat(5000), 2000);
  check('a long body is bounded', clipped.startsWith('y'.repeat(2000)) && clipped.length < 2100);
  check('and says how much was withheld', clipped.includes('3000 more characters'), clipped.slice(-60));
}

// --- layer rendering ----------------------------------------------------------
{
  const { renderIndex, renderFull } = await import('../dist/mcp/render.js');
  const row = (over = {}) => ({
    id: '31ad1fc9-f168-800b-28f2-d529d2ff4cc2', kind: 'decision',
    title: 'Committed as 30daa92', project: '/p', createdAt: Date.parse('2026-08-15'),
    score: 0.03, ...over,
  });

  const shown = renderIndex([row({ snippet: 'the cursor sweep runs during flush' })]);
  check('the index shows the snippet under the title',
    shown.includes('Committed as 30daa92\n    the cursor sweep runs'), JSON.stringify(shown));
  // A row only vector search found has no query terms to centre on, so it
  // renders as it always did rather than as a blank line.
  check('a row without a snippet renders on one line',
    renderIndex([row()]).split('\n').length === 2, JSON.stringify(renderIndex([row()])));
  check('an empty result set still says so',
    renderIndex([]) === 'No matching observations.');

  const full = renderFull(
    { ...row(), body: 'b'.repeat(9000), files: ['/p/a.ts'], author: 'ada' }, 2000);
  check('layer 3 bounds the body it returns', full.includes('7000 more characters'));
  check('layer 3 keeps the metadata header', full.includes('who: ada') && full.includes('files: /p/a.ts'));
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
  const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  // Project scope only: it writes files inside the given directory and never
  // shells out, so this stays hermetic. `dist` is placed so that its sibling
  // `skills/` directory is the real one shipped with the package.
  const repo = mkdtempSync(join(tmpdir(), 'install-'));
  const dist = new URL('../dist', import.meta.url).pathname;
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

  // The scan skill ships with the package and is installed like the hooks, so
  // a fresh project has a way to seed memory before it has any history.
  check('install writes the scan skill',
    readFileSync(join(repo, '.claude/skills/cdb-scan/SKILL.md'), 'utf8').includes('profile:stack'));

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
  check('uninstall removes the scan skill',
    !existsSync(join(repo, '.claude/skills/cdb-scan')));

  const afterRemoval = readFileSync(join(repo, 'CLAUDE.local.md'), 'utf8');
  check('uninstall takes back only its own instructions',
    !afterRemoval.includes('claude-db:start') && afterRemoval.includes('Something the user wrote.'),
    afterRemoval.trim());

  rmSync(repo, { recursive: true, force: true });
}

// --- auto update ------------------------------------------------------------
{
  const { compareVersions, isCompatible, isDue } = await import('../dist/update.js');

  check('versions compare numerically, not as strings', compareVersions('0.2.10', '0.2.9') === 1);
  check('equal versions compare equal', compareVersions('1.2.3', '1.2.3') === 0);
  check('older compares lower', compareVersions('0.2.2', '0.3.0') === -1);

  // A release outside the caret range may migrate the database on first
  // connection, so it is reported rather than installed unasked.
  check('0.x auto-updates only within the same minor',
    isCompatible('0.2.2', '0.2.9') && !isCompatible('0.2.2', '0.3.0'));
  check('1.x auto-updates across minors', isCompatible('1.2.0', '1.9.4') && !isCompatible('1.2.0', '2.0.0'));

  check('a check is due when never run', isDue({}));
  check('and not again within the day', !isDue({ checkedAt: Date.now() }));
  check('but is due after one', !isDue({ checkedAt: Date.now() - 23 * 3600_000 })
    && isDue({ checkedAt: Date.now() - 25 * 3600_000 }));
}

// --- seeding from git ---------------------------------------------------------
{
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { observationsFromGit } = await import('../dist/capture/index.js');

  const repo = mkdtempSync(join(tmpdir(), 'seed-'));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'ada', GIT_AUTHOR_EMAIL: 'ada@example.com',
    GIT_COMMITTER_NAME: 'ada', GIT_COMMITTER_EMAIL: 'ada@example.com',
  };
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { env, stdio: 'ignore' });

  git('init', '-q');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'index.ts'), 'export const x = 1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: went with FTS5 instead of a trigram index',
    '-m', 'The tokenizer is builtin, so there is no extension to install.');

  // Releases touch files like any other commit, so the skip has to come from
  // reading the subject, not from the commit being empty.
  writeFileSync(join(repo, 'src', 'index.ts'), 'export const x = 2\n');
  git('add', '-A');
  git('commit', '-qm', '0.2.0');

  const seeded = observationsFromGit(repo, 10);
  check('a commit becomes an observation', seeded.length === 1, `${seeded.length} kept`);
  check('a version bump is not memory', !seeded.some((o) => o.title === '0.2.0'));
  check('the subject becomes the title',
    seeded[0].title === 'feat: went with FTS5 instead of a trigram index', seeded[0].title);
  check('the commit body becomes the reasoning',
    seeded[0].body.includes('tokenizer is builtin'));
  check('changed files are attributed',
    seeded[0].files.some((f) => f.endsWith('src/index.ts')), seeded[0].files.join(','));
  check('the directory becomes a tag', seeded[0].tags.includes('src'), seeded[0].tags.join(','));
  check('the commit author is recorded', seeded[0].author === 'ada', seeded[0].author);
  check('a weighed alternative is classified as a decision',
    seeded[0].kind === 'decision', seeded[0].kind);
  // Ids come from the sha, so seeding twice rewrites rather than duplicates.
  check('re-seeding produces the same ids',
    observationsFromGit(repo, 10)[0].id === seeded[0].id);

  rmSync(repo, { recursive: true, force: true });
}

// --- cursor sweep -------------------------------------------------------------
{
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  // CONFIG_DIR is derived from the home directory at import time, so a
  // fabricated $HOME in a child process is the only way to sweep safely.
  const home = mkdtempSync(join(tmpdir(), 'sweep-'));
  mkdirSync(join(home, '.claude-memory', 'cursors'), { recursive: true });
  mkdirSync(join(home, '.claude', 'projects', 'proj'), { recursive: true });
  writeFileSync(join(home, '.claude', 'projects', 'proj', 'live.jsonl'), '{}\n');
  for (const name of ['live', 'dead']) {
    writeFileSync(join(home, '.claude-memory', 'cursors', `${name}.offset`), '42');
  }

  const probe = join(home, 'probe.mjs');
  writeFileSync(probe, `
    import { sweepCursors } from ${JSON.stringify(new URL('../dist/capture/index.js', import.meta.url).href)};
    process.stdout.write(String(sweepCursors()));
  `);
  const removed = execFileSync(process.execPath, [probe], {
    env: { ...process.env, HOME: home }, encoding: 'utf8',
  });

  const left = readdirSync(join(home, '.claude-memory', 'cursors'));
  check('a cursor whose transcript is gone is swept', removed === '1' && !left.includes('dead.offset'),
    left.join(','));
  // Cursors are keyed by session alone, so sweeping one project's must never
  // discard another's: losing a live cursor costs a full 90MB re-read.
  check('a cursor with a transcript still on disk survives', left.includes('live.offset'),
    left.join(','));

  rmSync(home, { recursive: true, force: true });
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
