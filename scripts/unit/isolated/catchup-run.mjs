import '../../lib/require-isolated.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { report } from '../../lib/isolated.mjs';
import { createContext } from '../../../dist/context.js';
import { remember } from '../../../dist/capture/index.js';
import { factToObservation } from '../../../dist/facts/model.js';
import { HANDOFF_KEY, HANDOFF_TAG, newestHandoff } from '../../../dist/facts/handoff.js';

const CLI = new URL('../../../dist/cli/index.js', import.meta.url).pathname;
const SESSION_START = new URL('../../../dist/hooks/session-start.js', import.meta.url).pathname;
const DAY = 86_400_000;
const NOTE = [
  'Handoff, Oct 6:',
  '- Done: timers, queue, mail family.',
  '- Open: PR #18 not merged.',
  '- Next: ask which retries to change on the worker queue.',
].join('\n');

mkdirSync(join(homedir(), '.claude-memory'), { recursive: true });
writeFileSync(
  join(homedir(), '.claude-memory', 'config.json'),
  JSON.stringify({ distill: { enabled: false }, updates: 'off' }),
);

const shop = join(homedir(), 'shop');
mkdirSync(shop);
const project = realpathSync(shop);
const git = (...args) =>
  execFileSync('git', ['-C', project, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    stdio: 'ignore',
  });
git('init', '-q');
writeFileSync(join(project, 'timers.txt'), 'one\n');
git('add', '.');
git('commit', '-q', '-m', 'feat: add timers');
writeFileSync(join(project, 'queue.txt'), 'two\n');
git('add', '.');
git('commit', '-q', '-m', 'fix: queue retries');
writeFileSync(join(project, 'mail.txt'), 'three\n');

function sessionContext(stdout) {
  try {
    return JSON.parse(stdout).hookSpecificOutput.additionalContext;
  } catch {
    return stdout;
  }
}

const catchup = (cwd) =>
  spawnSync(process.execPath, ['--no-warnings', CLI, 'catchup'], {
    cwd,
    env: process.env,
    encoding: 'utf8',
  });

const empty = join(homedir(), 'empty');
mkdirSync(empty);
const nothing = catchup(empty);
report(
  'a project with nothing recorded says so',
  nothing.status === 0 && nothing.stdout.trim() === 'Nothing recorded for this project yet.',
  nothing.stdout,
);

const ctx = await createContext();
try {
  const at = Date.now() - 2 * DAY;
  await ctx.store.upsertSession({
    id: 'chat-1',
    project,
    startedAt: at,
    endedAt: at + 2000,
    summary: 'Reworked the worker queue retries',
  });
  await ctx.store.insertObservations([
    {
      id: randomUUID(),
      sessionId: 'chat-1',
      project,
      kind: 'pattern',
      title: 'Asked: add retries to the worker queue',
      body: 'Asked: add retries to the worker queue',
      files: [],
      tags: [],
      createdAt: at,
      status: 'done',
    },
    {
      id: randomUUID(),
      sessionId: 'chat-1',
      project,
      kind: 'pattern',
      title: 'Asked: wire the mail family',
      body: 'Asked: wire the mail family',
      files: [],
      tags: [],
      createdAt: at + 1000,
      status: 'open',
    },
    factToObservation(
      {
        key: 'retries-stay-3',
        type: 'decision',
        scope: 'project',
        text: 'Retries stay at 3 because the queue already backs off.',
        files: [],
        at,
        source: 'test',
      },
      project,
    ),
    factToObservation(
      {
        key: 'second-pool',
        type: 'deadend',
        scope: 'project',
        text: 'A second worker pool doubled the mail cost.',
        files: [],
        at,
        source: 'test',
      },
      project,
    ),
    factToObservation(
      {
        key: 'worker-retries',
        type: 'todo',
        scope: 'project',
        text: 'Ask which retries to change on the worker queue.',
        files: [],
        at,
        source: 'test',
      },
      project,
    ),
  ]);

  const before = catchup(project);
  report(
    'catchup names the last chat, its work, the to-do, the open work and the git state',
    before.status === 0 &&
      before.stdout.includes('Last chat (') &&
      before.stdout.includes('Reworked the worker queue retries') &&
      before.stdout.includes('Asked: add retries to the worker queue') &&
      before.stdout.includes('Still to do (from facts):') &&
      before.stdout.includes('Ask which retries to change on the worker queue.') &&
      before.stdout.includes('Not committed yet (recorded work):') &&
      before.stdout.includes('Asked: wire the mail family') &&
      before.stdout.includes('?? mail.txt') &&
      before.stdout.includes('fix: queue retries') &&
      before.stdout.includes('feat: add timers'),
    before.stdout,
  );
  report(
    'catchup shows the branch with how many files are uncommitted',
    /Branch: \S+, 1 file uncommitted/.test(before.stdout),
    before.stdout,
  );
  report(
    'and the decisions and dead ends, with their reasons',
    before.stdout.includes('Decisions and dead ends (from facts):') &&
      before.stdout.includes('Decided: Retries stay at 3 because the queue already backs off.') &&
      before.stdout.includes('Dead end: A second worker pool doubled the mail cost.'),
    before.stdout,
  );
  report(
    'and shows no handoff section before one is saved',
    !before.stdout.includes('Last handoff'),
  );

  await remember(ctx, {
    project,
    kind: 'context',
    key: HANDOFF_KEY,
    tags: [HANDOFF_TAG],
    text: NOTE,
  });
  const after = catchup(project);
  report(
    'catchup shows the saved handoff with its done, open and next lines',
    after.stdout.includes('Last handoff (') &&
      after.stdout.includes('- Done: timers, queue, mail family.') &&
      after.stdout.includes('- Open: PR #18 not merged.') &&
      after.stdout.includes('- Next: ask which retries to change on the worker queue.'),
    after.stdout,
  );

  const second = spawnSync(process.execPath, ['--no-warnings', SESSION_START], {
    cwd: project,
    env: process.env,
    input: JSON.stringify({ cwd: project, source: 'startup', session_id: 'chat-2' }),
    encoding: 'utf8',
  });
  const context = sessionContext(second.stdout);
  report(
    'a second chat finds the handoff at the start, with all three lines',
    second.status === 0 &&
      context.includes('Last handoff (') &&
      context.includes('- Done: timers, queue, mail family.') &&
      context.includes('- Open: PR #18 not merged.') &&
      context.includes('- Next: ask which retries to change on the worker queue.'),
    context,
  );
  report(
    'and the first handoff line carries the note id, so the full text can be expanded',
    /- Done: timers, queue, mail family\. \([0-9a-f]{8}-[0-9a-f]{4}\)/.test(context),
    context,
  );
  report(
    'and the handoff is not repeated as a plain rule line',
    !/Rule \([^)]*\): Handoff/.test(context),
    context,
  );

  await remember(ctx, {
    project,
    kind: 'context',
    key: HANDOFF_KEY,
    tags: [HANDOFF_TAG],
    text: 'Handoff, Oct 7:\n- Done: retries.\n- Open: none.\n- Next: release.',
  });
  const notes = (await ctx.store.list({ project, sessionId: 'manual', limit: 50 })).filter((obs) =>
    obs.tags.includes(HANDOFF_TAG),
  );
  report(
    'a new handoff replaces the old one instead of piling up',
    notes.length === 1 && notes[0].body.includes('Next: release.'),
    String(notes.length),
  );

  const secret =
    'Handoff, Oct 7:\n- Done: login.\n- Open: api_key = abcdefgh12345678.\n- Next: rotate.';
  const secretNote = await remember(ctx, {
    project: join(homedir(), 'other'),
    kind: 'context',
    key: HANDOFF_KEY,
    tags: [HANDOFF_TAG],
    text: secret,
  });
  report(
    'a secret in a handoff is removed before it is saved',
    !secretNote.body.includes('abcdefgh12345678') && secretNote.body.includes('[redacted]'),
    secretNote.body,
  );

  const stale = join(homedir(), 'stale');
  await ctx.store.insertObservations([
    {
      id: randomUUID(),
      sessionId: 'manual',
      project: stale,
      kind: 'context',
      title: 'Handoff, Sep 1:',
      body: 'Handoff, Sep 1:\n- Done: old.\n- Open: old.\n- Next: old.',
      files: [],
      tags: ['manual', HANDOFF_TAG],
      createdAt: Date.now() - 20 * DAY,
    },
  ]);
  report(
    'a handoff older than 14 days is not shown',
    (await newestHandoff(ctx, stale)) === null && (await newestHandoff(ctx, project)) !== null,
  );
} finally {
  await ctx.close();
}
