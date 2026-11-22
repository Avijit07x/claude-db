import '../../lib/require-isolated.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { report } from '../../lib/isolated.mjs';
import { createContext } from '../../../dist/context.js';
import { factToObservation } from '../../../dist/facts/model.js';
import { HANDOFF_TAG, passedNote } from '../../../dist/facts/handoff.js';
import { recentChats, turnLine } from '../../../dist/facts/last-chat.js';
import { startFacts } from '../../../dist/facts/start.js';
import { recordActive } from '../../../dist/capture/active.js';
import { readShown } from '../../../dist/hooks/shown.js';
import { promptCandidates } from '../../../dist/hooks/prompt-recall.js';

const CLI = new URL('../../../dist/cli/index.js', import.meta.url).pathname;
const SESSION_START = new URL('../../../dist/hooks/session-start.js', import.meta.url).pathname;
const HOUR = 3_600_000;
const now = Date.now();

mkdirSync(join(homedir(), '.claude-memory'), { recursive: true });
writeFileSync(
  join(homedir(), '.claude-memory', 'config.json'),
  JSON.stringify({ distill: { enabled: false }, updates: 'off', embeddings: { provider: 'none' } }),
);

const folder = (name) => {
  const path = join(homedir(), name);
  mkdirSync(path, { recursive: true });
  return realpathSync(path);
};

const turn = (project, sessionId, asked, createdAt, extra = {}) => ({
  id: randomUUID(),
  sessionId,
  project,
  kind: 'context',
  title: `Did ${asked}`,
  body: `Asked: ${asked}\n\nDone.`,
  files: [],
  tags: [],
  createdAt,
  status: 'done',
  ...extra,
});

const note = (project, createdAt) => ({
  id: randomUUID(),
  sessionId: 'manual',
  project,
  kind: 'context',
  title: 'Handoff, Oct 7:',
  body: 'Handoff, Oct 7:\n- Done: queue retries.\n- Open: PR #18.\n- Next: release.',
  files: [],
  tags: ['manual', HANDOFF_TAG],
  createdAt,
  status: 'done',
});

const rule = (project) =>
  factToObservation(
    {
      key: 'retries',
      type: 'decision',
      scope: 'project',
      text: 'Retries stay at 3.',
      files: [],
      at: now - 5 * HOUR,
      source: 'test',
    },
    project,
  );

function hookContext(project, sessionId) {
  const result = spawnSync(process.execPath, ['--no-warnings', SESSION_START], {
    cwd: project,
    env: process.env,
    input: JSON.stringify({ cwd: project, source: 'startup', session_id: sessionId }),
    encoding: 'utf8',
  });
  try {
    return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  } catch {
    return result.stdout;
  }
}

function catchup(project, sessionId) {
  const env = { ...process.env };
  delete env.CLAUDE_CODE_SESSION_ID;
  if (sessionId) env.CLAUDE_CODE_SESSION_ID = sessionId;
  return spawnSync(process.execPath, ['--no-warnings', CLI, 'catchup'], {
    cwd: project,
    env,
    encoding: 'utf8',
  }).stdout;
}

const ctx = await createContext();
const lastChat = async (project, current) => (await recentChats(ctx, project, current))[0] ?? null;
try {
  const empty = folder('empty');
  report('a project with nothing saved has no last chat', (await lastChat(empty)) === null);

  const notes = folder('notes');
  await ctx.store.insertObservations([
    note(notes, now - HOUR),
    rule(notes),
    { ...turn(notes, 'git', 'feat: add timers', now - 2 * HOUR), body: 'feat: add timers' },
  ]);
  report(
    'facts, manual notes and git commits are never taken for a chat',
    (await lastChat(notes)) === null,
  );

  const solo = folder('solo');
  await ctx.store.insertObservations([turn(solo, 'chat-a', 'fix the queue', now - HOUR)]);
  report(
    'the chat that is starting never names itself',
    (await lastChat(solo, 'chat-a')) === null && (await lastChat(solo))?.sessionId === 'chat-a',
  );

  const shop = folder('shop');
  const elsewhere = folder('elsewhere');
  await ctx.store.insertObservations([
    turn(elsewhere, 'chat-other', 'tune the other project', now),
  ]);
  const longAsk = `rework the mail family ${'and the retries '.repeat(12)}`;
  const openTurns = [
    turn(shop, 'chat-open', 'wire the mail family', now - 30 * HOUR),
    turn(shop, 'chat-open', 'add the retry test', now - 6 * HOUR),
    turn(shop, 'chat-open', 'drop the old flag', now - 5 * HOUR, { status: 'replaced' }),
    turn(shop, 'chat-open', 'bump the queue size', now - 4 * HOUR),
    turn(shop, 'chat-open', 'rename the worker', now - 3 * HOUR),
    turn(shop, 'chat-open', 'split the mailer', now - 2 * HOUR),
    turn(shop, 'chat-open', longAsk, now - HOUR),
  ];
  await ctx.store.upsertSession({
    id: 'chat-open',
    project: shop,
    startedAt: now - 30 * HOUR,
    summary: 'Did wire the mail family',
  });
  await ctx.store.upsertSession({
    id: 'chat-morning',
    project: shop,
    startedAt: now - 9 * HOUR,
    endedAt: now - 8 * HOUR,
    summary: 'Morning work on the docs',
  });
  await ctx.store.insertObservations([
    ...openTurns,
    turn(shop, 'chat-morning', 'fix a typo in the docs', now - 9 * HOUR),
  ]);

  const open = await lastChat(shop);
  report(
    'a chat used today beats a chat that started later but stopped earlier',
    open?.sessionId === 'chat-open' && open.at === now - HOUR,
    open?.sessionId,
  );
  report("another project's newer chat is never taken", open?.sessionId === 'chat-open');
  report(
    'an open chat shows no summary, since it only covers its first turns',
    open?.summary.length === 0,
  );
  const asked = open?.turns.map((row) => row.body.split('\n')[0]) ?? [];
  report(
    'the newest 5 turns are kept, oldest first, without replaced ones',
    open?.turns.length === 5 &&
      asked[0] === 'Asked: add the retry test' &&
      asked.at(-1)?.startsWith('Asked: rework the mail family') &&
      !asked.includes('Asked: drop the old flag'),
    asked.join(' / '),
  );
  const longLine = turnLine(open?.turns.at(-1));
  report(
    'a long request is cut to 120 characters',
    longLine.startsWith('asked "rework the mail family') && longLine.includes('…"'),
    longLine,
  );
  report(
    'a line names the request and what was done',
    turnLine(openTurns[1]) === 'asked "add the retry test": Did add the retry test',
  );
  report(
    'a row with no request shows its title alone',
    turnLine({ ...openTurns[1], body: 'No request here.' }) === 'Did add the retry test',
  );

  await ctx.store.upsertSession({
    id: 'chat-open',
    project: shop,
    startedAt: now - 30 * HOUR,
    endedAt: now - HOUR + 1000,
    summary: `Reworked the mail family. ${'The retries now back off. '.repeat(20)}`,
  });
  const ended = await lastChat(shop);
  report(
    'an ended chat shows its summary, cut to 300 characters',
    ended?.summary[0]?.startsWith('Reworked the mail family.') && ended.summary[0].length <= 301,
    ended?.summary.join('; '),
  );

  await ctx.store.insertObservations([turn(shop, 'chat-open', 'resume and fix', now - 1000)]);
  const resumed = await lastChat(shop);
  report(
    'a chat resumed after it ended counts as open again, so its old summary is not shown',
    resumed?.summary.length === 0 && resumed.at === now - 1000,
    resumed?.summary.join('; '),
  );

  const unsaved = folder('unsaved');
  await ctx.store.insertObservations([turn(unsaved, 'chat-x', 'start the api', now - HOUR)]);
  const noRecord = await lastChat(unsaved);
  report(
    'a chat with no session record is still found, with no summary',
    noRecord?.sessionId === 'chat-x' &&
      noRecord.summary.length === 0 &&
      noRecord.turns.length === 1,
  );

  const handoff = note(shop, now - 2 * HOUR);
  report(
    'a note passed by a later request is out of date',
    passedNote(handoff.createdAt, now - HOUR) &&
      !passedNote(handoff.createdAt, handoff.createdAt) &&
      !passedNote(handoff.createdAt, null),
  );

  const start = folder('start');
  const fresh = note(start, now - 3 * HOUR);
  await ctx.store.insertObservations([
    rule(start),
    fresh,
    turn(start, 'chat-a', 'add the queue', now - 4 * HOUR),
    turn(start, 'chat-a', 'write the handoff', now - 3 * HOUR - 1000),
  ]);
  const before = await startFacts(ctx, start, new Set(), 'chat-b');
  const block = before?.block ?? '';
  const order = ['This project:', 'Last chat (', 'Last handoff (', 'Where you stopped:']
    .map((heading) => block.indexOf(heading))
    .filter((index) => index !== -1);
  report(
    'a new chat sees the last chat, between the project facts and the handoff',
    block.includes('Last chat (') &&
      block.includes('- asked "add the queue": Did add the queue (') &&
      order.length === 3 &&
      order.every((index, i) => i === 0 || index > order[i - 1]),
    block,
  );
  report(
    'a handoff with no request after it is shown with no mark',
    /Last handoff \([A-Z][a-z]{2} \d{1,2}\):/.test(block) &&
      block.includes('- Done: queue retries.'),
    block,
  );
  const [shownTurn] = await ctx.store.list({ project: start, sessionId: 'chat-a', limit: 1 });
  report(
    'the last chat rows are reported as shown, so prompts do not repeat them',
    before?.ids.has(shownTurn.id),
  );

  await ctx.store.insertObservations([turn(start, 'chat-a', 'keep going', now - HOUR)]);
  const after = (await startFacts(ctx, start, new Set(), 'chat-b'))?.block ?? '';
  report(
    'a handoff with a request after it is kept, marked older than the last chat, never as a plain line',
    after.includes(', older than the last chat):') &&
      after.split('queue retries').length === 2 &&
      after.includes('asked "keep going"'),
    after,
  );
  const ownChat = (await startFacts(ctx, start, new Set(), 'chat-a'))?.block ?? '';
  report(
    'a resumed chat does not show itself as the last chat',
    !ownChat.includes('Last chat ('),
    ownChat,
  );
  const restored = (await startFacts(ctx, start, new Set([shownTurn.id]), 'chat-b'))?.block ?? '';
  report(
    'rows already restored after a compact are not repeated',
    !restored.includes('asked "add the queue"') && restored.includes('asked "keep going"'),
    restored,
  );

  const maxChars = ctx.config.inject.maxChars;
  ctx.config.inject.maxChars = 120;
  const tight = (await startFacts(ctx, start, new Set(), 'chat-b'))?.block ?? '';
  ctx.config.inject.maxChars = maxChars;
  const bodyChars = tight
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .reduce((sum, line) => sum + line.length + 1, 0);
  report('the last chat stays within the start budget', bodyChars <= 120, tight);

  const hook = folder('hook');
  await ctx.store.insertObservations([
    rule(hook),
    turn(hook, 'chat-1', 'ship the release', now - HOUR),
  ]);
  const second = hookContext(hook, 'chat-2');
  report(
    "end to end, a second chat starts with the first chat's requests while it is still open",
    second.includes('Last chat (') && second.includes('asked "ship the release"'),
    second,
  );
  const resumedHook = hookContext(hook, 'chat-1');
  report(
    'end to end, the first chat resumed does not see itself',
    !resumedHook.includes('Last chat ('),
    resumedHook,
  );

  await ctx.store.insertObservations([note(hook, now - 2 * HOUR)]);
  const outside = catchup(hook);
  report(
    'catchup marks a handoff that newer work has passed',
    outside.includes('Last handoff (') &&
      outside.includes('older than the last chat') &&
      outside.includes('asked "ship the release"'),
    outside,
  );
  const inside = catchup(hook, 'chat-1');
  report(
    'catchup run inside a chat does not name that chat as the last one',
    !inside.includes('Last chat (') && !inside.includes('older than the last chat'),
    inside,
  );

  {
    const DAY = 24 * HOUR;
    const memoryDir = join(homedir(), '.claude-memory');
    const norm = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim();
    const bullets = (text) =>
      text
        .split('\n')
        .filter((line) => line.startsWith('- '))
        .map((line) =>
          norm(
            line
              .replace(/ \([0-9a-f]{8}-[0-9a-f]{4}\)$/, '')
              .replace(/^- /, '')
              .replace(
                /^(Rule|Decided|Dead end|Fact|To do|Not committed|Summary)( \([^)]*\))?: /,
                '',
              )
              .replace(/^asked "[^"]*": /, ''),
          ),
        );
    const printedTwice = (text) =>
      bullets(text).filter(
        (core, index, all) =>
          core.length > 15 &&
          all.slice(0, index).some((other) => other.includes(core) || core.includes(other)),
      );

    const repo = (name) => {
      const path = folder(name);
      const git = (...args) =>
        execFileSync('git', ['-C', path, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
          stdio: 'ignore',
        });
      git('init', '-q');
      writeFileSync(join(path, 'timers.txt'), 'one\n');
      git('add', '.');
      git('commit', '-q', '-m', 'feat: add timers');
      writeFileSync(join(path, 'mail.txt'), 'two\n');
      return path;
    };

    const runStart = (project, sessionId, source = 'startup') => {
      const result = spawnSync(process.execPath, ['--no-warnings', SESSION_START], {
        cwd: project,
        env: process.env,
        input: JSON.stringify({ cwd: project, source, session_id: sessionId }),
        encoding: 'utf8',
      });
      try {
        const out = JSON.parse(result.stdout);
        return {
          context: out.hookSpecificOutput?.additionalContext ?? '',
          system: out.systemMessage ?? '',
        };
      } catch {
        return { context: result.stdout, system: '' };
      }
    };

    const MCP_SERVER = new URL('../../../dist/mcp/server.js', import.meta.url).pathname;
    const WIRING = 'Started wiring the mail family in mail.txt';
    const POOL = 'Chose one worker pool for mail and the queue';
    const CAP = 'Went with a retry cap of 3 because the queue already backs off';
    const openRow = (project, sessionId, title, at) =>
      turn(project, sessionId, 'wire the mail family', at, {
        kind: 'pattern',
        title,
        status: 'open',
        files: [join(project, 'mail.txt')],
      });
    const chat = (project, id, at, summary) =>
      ctx.store.upsertSession({
        id,
        project,
        startedAt: at,
        endedAt: at + 5 * 60_000,
        ...(summary ? { summary } : {}),
      });

    const bare = repo('bare');
    const chatRule = turn(bare, 'bare-Z', 'always use pnpm', now - 10 * DAY, {
      kind: 'preference',
      title: 'Always use pnpm and never npm',
    });
    await ctx.store.insertObservations([
      chatRule,
      turn(bare, 'bare-A', 'add retries', now - 3 * DAY + 1000, { title: CAP }),
      openRow(bare, 'bare-B', WIRING, now - DAY),
      turn(bare, 'bare-B', 'why does mail fail', now - DAY + 1000, { title: POOL }),
      turn(bare, 'bare-B', 'write the docs', now - DAY + 2000, { title: 'Wrote the mail docs' }),
      turn(bare, 'bare-B', 'fix the cache', now - DAY + 3000, { title: 'Fixed the CI cache' }),
    ]);
    await chat(bare, 'bare-Z', now - 10 * DAY);
    await chat(bare, 'bare-A', now - 3 * DAY, `${CAP} | Fixed the timer that fired twice`);
    await chat(bare, 'bare-B', now - DAY);
    const ruleLine = new RegExp(`^- Rule \\([^)]*\\): ${chatRule.title}`, 'm');
    const blank = runStart(bare, 'new-blank');
    report(
      'a project with no facts prints no line twice and has one block',
      printedTwice(blank.context).length === 0 && !blank.context.includes('<project-memory>'),
      blank.context,
    );
    report(
      'a project with no facts still shows its chat-caught rule',
      ruleLine.test(blank.context),
      blank.context,
    );

    const once = repo('once');
    const fact = (key, type, text, scope = 'project') =>
      factToObservation(
        { key, type, scope, text, files: [], at: now - 2 * DAY, source: 't' },
        once,
      );
    const ruleRow = turn(once, 'once-A', 'always use pnpm', now - 3 * DAY, {
      kind: 'preference',
      title: 'Always use pnpm and never npm',
    });
    const stagedOpen = {
      ...openRow(once, 'once-Z', 'Drafted the invoice export in invoice.txt', now - 9 * DAY),
      files: [join(once, 'invoice.txt')],
    };
    writeFileSync(join(once, 'invoice.txt'), 'draft\n');
    const manualRule = {
      ...turn(once, 'manual', 'x', now - HOUR, { kind: 'preference' }),
      title: 'Never store card numbers in logs',
      body: 'Never store card numbers in logs',
      tags: ['manual'],
    };
    await ctx.store.insertObservations([
      ruleRow,
      turn(once, 'once-A', 'add retries', now - 3 * DAY + 1000, { title: CAP, kind: 'decision' }),
      turn(once, 'once-A', 'fix timers', now - 3 * DAY + 2000, { title: 'Fixed the timer' }),
      stagedOpen,
      openRow(once, 'once-B', WIRING, now - DAY),
      turn(once, 'once-B', 'why does mail fail', now - DAY + 1000, { title: POOL }),
      openRow(once, 'once-D', WIRING, now - 20 * 60_000),
      turn(once, 'once-D', 'sqlite or postgres', now - 19 * 60_000, {
        kind: 'decision',
        title: 'Chose SQLite over Postgres for the queue',
      }),
      manualRule,
      note(once, now - HOUR),
      fact('pnpm', 'rule', 'Use pnpm in this repo.'),
      fact('terse', 'rule', 'Keep replies short and plain.', 'you'),
      fact('cap', 'decision', CAP),
      fact('mail-todo', 'todo', 'Wire the mail family and check the sender domain.'),
    ]);
    await chat(
      once,
      'once-A',
      now - 3 * DAY,
      `${CAP} | Chose a single timer wheel | Moved to UTC | Fixed the timer`,
    );
    await chat(once, 'once-B', now - DAY, `${POOL} | ${WIRING}`);
    recordActive('once-C', once, 'export invoices to csv and email them to finance');

    writeFileSync(
      join(once, '.mcp.json'),
      JSON.stringify({ mcpServers: { memory: { command: 'node', args: [MCP_SERVER] } } }),
    );
    const first = runStart(once, 'new-facts');
    report(
      'a project with facts prints no line twice',
      printedTwice(first.context).length === 0,
      `${printedTwice(first.context).join(' || ')}\n${first.context}`,
    );
    report(
      'a chat summary shows only the parts not shown yet, joined with "; "',
      first.context.includes('- Summary: Chose a single timer wheel; Moved to UTC') &&
        !first.context.includes(' | '),
      first.context,
    );
    const picksNothingShown = async (project, sessionId, prompt, ids) => {
      const shown = readShown(sessionId);
      const request = { prompt, project, sessionId };
      const fresh = await promptCandidates(ctx, { ...request, shown: new Set() });
      const picked = await promptCandidates(ctx, { ...request, shown });
      const wanted = (entries) => ids.every((id) => entries?.some((entry) => entry.id === id));
      return wanted(fresh?.entries) && !picked?.entries.some((entry) => shown.has(entry.id));
    };
    report(
      'the start marks the open work as shown, and the next prompt picks none of it',
      readShown('new-facts').has(stagedOpen.id) &&
        (await picksNothingShown(once, 'new-facts', 'drafted the invoice export draft', [
          stagedOpen.id,
        ])),
      [...readShown('new-facts')].join(','),
    );

    const compact = runStart(once, 'once-D', 'compact');
    report(
      'after a compact no line is printed twice',
      printedTwice(compact.context).length === 0 &&
        compact.context.includes('Earlier in this chat:'),
      `${printedTwice(compact.context).join(' || ')}\n${compact.context}`,
    );

    const aboutYou = runStart(bare, 'new-you');
    report(
      'an about-you fact does not hide the chat-caught rule of a project with no rule facts',
      aboutYou.context.includes('About you:') && ruleLine.test(aboutYou.context),
      aboutYou.context,
    );
    report(
      'the start marks a chat-caught rule as shown, and the next prompt picks none of it',
      readShown('new-you').has(chatRule.id) &&
        (await picksNothingShown(bare, 'new-you', chatRule.title, [chatRule.id])),
      [...readShown('new-you')].join(','),
    );

    report(
      'the hints for the user are not part of what Claude reads',
      first.system.includes('claude-db scan') &&
        !first.context.includes('claude-db scan') &&
        !first.context.includes('MCP') &&
        !first.context.includes('memory MCP tools') &&
        !first.context.includes('full history') &&
        !first.context.includes('(context ≈'),
      `${first.system}\n${first.context}`,
    );

    writeFileSync(
      join(memoryDir, 'config.json'),
      JSON.stringify({ distill: { enabled: false }, embeddings: { provider: 'none' } }),
    );
    writeFileSync(
      join(memoryDir, 'update.json'),
      JSON.stringify({ checkedAt: Date.now(), latest: '99.0.0' }),
    );
    const update = runStart(once, 'new-update');
    rmSync(join(memoryDir, 'update.json'), { force: true });
    report(
      'the update notice goes to the user and not to Claude',
      update.system.includes('99.0.0 is available') && !update.context.includes('is available'),
      `${update.system}\n${update.context}`,
    );
  }
} finally {
  await ctx.close();
}
