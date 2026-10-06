import '../../lib/require-isolated.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { report } from '../../lib/isolated.mjs';
import { CONFIG_PATH } from '../../../dist/config/index.js';
import { createContext } from '../../../dist/context.js';
import { embedObservations } from '../../../dist/capture/index.js';
import { claudeMemoryDir, importClaudeMemory } from '../../../dist/facts/claude-memory.js';
import { factToObservation } from '../../../dist/facts/model.js';
import { startFacts } from '../../../dist/facts/start.js';
import { promptCandidates } from '../../../dist/hooks/prompt-recall.js';

const dist = new URL('../../../dist/', import.meta.url).pathname;
const shop = join(homedir(), 'shop');
mkdirSync(shop, { recursive: true });
const project = realpathSync(shop);
const other = '/p/other';
const ctx = await createContext();

const fact = (key, type, scope, text) =>
  factToObservation(
    { key, type, scope, text, files: [], at: Date.now() - 3_600_000, source: 'From a chat.' },
    project,
  );
const raw = (title, extra = {}) => ({
  id: randomUUID(),
  sessionId: 'old-chat',
  project,
  kind: 'pattern',
  title,
  body: `Asked: ${title}`,
  files: [],
  tags: [],
  createdAt: Date.now() - 7_200_000,
  status: 'done',
  ...extra,
});
const ask = async (prompt, inProject = project) => {
  const found = await promptCandidates(ctx, {
    prompt,
    project: inProject,
    sessionId: 'live',
    shown: new Set(),
  });
  return found ? { block: found.entries.map((entry) => entry.title).join('\n') } : null;
};

try {
  const rows = [
    fact('plain-text', 'rule', 'you', 'Reply in plain text, never in tables.'),
    fact('timers', 'decision', 'project', 'All 12 timers fire after 1.1s.'),
    fact('worker-retries', 'todo', 'project', 'Ask which retries to change on the worker queue.'),
    raw('The timers now fire more slowly in both services'),
    raw('Rounded order totals to whole cents'),
    raw('Padding added to the settings panel', { status: 'open', files: [`${project}/a.ts`] }),
  ];
  await embedObservations(ctx, rows);
  await ctx.store.insertObservations(rows);

  const timers = await ask('make the timers fire slower');
  report(
    'above a prompt, candidates come from earlier chats, not from facts',
    timers?.block.includes('both services') && !timers.block.includes('All 12 timers'),
    timers?.block,
  );
  const totals = await ask('why are order totals rounded to cents');
  report(
    'raw rows are candidates for prompts as before',
    totals?.block.includes('Rounded order totals'),
    totals?.block,
  );
  const elsewhere = (await startFacts(ctx, other))?.block ?? '';
  report(
    'a rule about the user opens chats in every project',
    elsewhere.includes('About you:') && elsewhere.includes('never in tables'),
    elsewhere,
  );

  const start = await startFacts(ctx, project);
  const block = start?.block ?? '';
  report(
    'the start block has the three sections',
    ['About you:', 'This project:', 'Where you stopped:'].every((heading) =>
      block.includes(heading),
    ),
    block,
  );
  report(
    'unfinished work and todos are where you stopped',
    block.includes('To do (') && block.includes('- Not committed: Padding added'),
  );
  report('the start block reports only facts it showed', start?.ids.size === 3);

  const memory = claudeMemoryDir(project);
  mkdirSync(memory, { recursive: true });
  const memoryFile = (name, type, description, body) =>
    writeFileSync(
      join(memory, `${name}.md`),
      `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  type: ${type}\n---\n\n${body}\n`,
    );
  memoryFile(
    'run-tests',
    'feedback',
    'Always run the tests before a commit',
    'The user wants green tests.',
  );
  memoryFile(
    'simple-english',
    'user',
    'Write commit messages in the imperative mood',
    'Short and clear.',
  );
  writeFileSync(join(memory, 'MEMORY.md'), '- [No git](run-tests.md)\n');
  const imported = await importClaudeMemory(ctx, project);
  report(
    'Claude memory files are imported, the index is not',
    imported.files === 2 && imported.saved === 2,
    JSON.stringify(imported),
  );
  report(
    'an unchanged file is not saved again',
    (await importClaudeMemory(ctx, project)).saved === 0,
  );
  memoryFile('run-tests', 'feedback', 'Always run the full tests before a commit', 'Changed.');
  report('a changed file is saved again', (await importClaudeMemory(ctx, project)).saved === 1);

  const here = (await startFacts(ctx, project))?.block ?? '';
  report(
    'where Claude already sees its own memory file, it is not repeated',
    !here.includes('Always run the tests') && !here.includes('imperative mood'),
    here,
  );
  const away = (await startFacts(ctx, other))?.block ?? '';
  report(
    'a memory Claude keeps for one project does not leak into another',
    !away.includes('imperative mood'),
    away,
  );
  const [english] = (await ctx.store.list({ project, sessionId: 'facts', limit: 100 })).filter(
    (obs) => obs.title.includes('imperative mood'),
  );
  await ctx.store.insertObservations([
    {
      ...english,
      tags: english.tags.map((tag) => (tag.startsWith('machine:') ? 'machine:elsewhere' : tag)),
    },
  ]);
  const synced = (await startFacts(ctx, project))?.block ?? '';
  report(
    'on another machine, where Claude cannot see the file, the same project shows it',
    synced.includes('imperative mood'),
    synced,
  );

  rmSync(join(memory, 'run-tests.md'));
  report(
    'a deleted memory file retires its fact',
    (await importClaudeMemory(ctx, project)).retired === 1,
  );
} finally {
  await ctx.close();
}

const hook = (session) =>
  execFileSync(process.execPath, ['--no-warnings', join(dist, 'hooks', 'session-start.js')], {
    input: JSON.stringify({ session_id: session, cwd: project, source: 'startup' }),
    env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_DB_CAPTURE: '' },
    encoding: 'utf8',
  });
const firstStart = hook('first');
let parsed = null;
try {
  parsed = JSON.parse(firstStart);
} catch {}
report(
  'the first session start tells the user once',
  typeof parsed?.systemMessage === 'string' &&
    parsed.systemMessage.includes('claude-db distill off'),
  firstStart.slice(0, 120),
);
report(
  'and still gives Claude the facts',
  parsed?.hookSpecificOutput?.additionalContext.includes('About you:'),
);
const secondStart = hook('second');
report(
  'the next session start is plain context again',
  secondStart.startsWith('<memory>') && !secondStart.includes('systemMessage'),
  secondStart.slice(0, 60),
);

const cli = (...args) =>
  execFileSync(process.execPath, ['--no-warnings', join(dist, 'cli', 'index.js'), ...args], {
    cwd: project,
    encoding: 'utf8',
  });
cli('distill', 'off');
const saved = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
report(
  'turning facts off writes only that one setting',
  JSON.stringify(saved) === '{"distill":{"enabled":false}}',
  JSON.stringify(saved),
);
cli('distill', 'on');
report('and the status says so', cli('distill').includes('distill  : on'));
