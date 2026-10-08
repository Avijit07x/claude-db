import '../../lib/require-isolated.mjs';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { report } from '../../lib/isolated.mjs';
import { createContext } from '../../../dist/context.js';
import { factToObservation } from '../../../dist/facts/model.js';
import { HANDOFF_TAG } from '../../../dist/facts/handoff.js';
import {
  activeRequests,
  activeToken,
  clearActive,
  recordActive,
  sweepActive,
} from '../../../dist/capture/active.js';

const HOOKS = new URL('../../../dist/hooks/', import.meta.url).pathname;
const CLI = new URL('../../../dist/cli/index.js', import.meta.url).pathname;
const MIN = 60_000;
const memoryDir = join(homedir(), '.claude-memory');
mkdirSync(memoryDir, { recursive: true });
writeFileSync(
  join(memoryDir, 'config.json'),
  JSON.stringify({ distill: { enabled: false }, pick: { enabled: false }, updates: 'off' }),
);

const env = { ...process.env, CLAUDE_CODE_EXECPATH: process.execPath };
delete env.CLAUDE_CODE_ENTRYPOINT;
delete env.CLAUDE_DB_CAPTURE;
delete env.CLAUDE_CODE_SESSION_ID;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const ctx = await createContext();

function world(name) {
  const dir = join(homedir(), name);
  mkdirSync(dir, { recursive: true });
  const project = realpathSync(dir);
  const base = Date.now() - 120 * MIN;
  const log = (chat) => join(homedir(), `${name}-${chat}.jsonl`);
  const hook = (file, payload, extraEnv = {}) =>
    spawnSync(process.execPath, ['--no-warnings', join(HOOKS, file)], {
      cwd: project,
      env: { ...env, ...extraEnv },
      encoding: 'utf8',
      input: JSON.stringify({ cwd: project, transcript_path: log(payload.session_id), ...payload }),
    });
  const write = (chat, entry) => appendFileSync(log(chat), `${JSON.stringify(entry)}\n`);

  const savedRows = async (chat) =>
    (await ctx.store.list({ project, sessionId: chat, limit: 100 })).map((row) => row.body);

  const waitFor = async (test) => {
    for (let tries = 0; tries < 200; tries += 1) {
      if (await test()) return true;
      await sleep(50);
    }
    return false;
  };

  const askOnly = (chat, minute, prompt, extraEnv) => {
    hook(
      'user-prompt.js',
      { session_id: chat, prompt, hook_event_name: 'UserPromptSubmit' },
      extraEnv,
    );
    write(chat, {
      type: 'user',
      timestamp: new Date(base + minute * MIN).toISOString(),
      message: { content: prompt },
    });
  };

  const reply = (chat, minute, text, file = 'src/x.ts') => {
    const content = text ? [{ type: 'text', text }] : [];
    if (file) {
      content.push({
        type: 'tool_use',
        id: `t${minute}`,
        name: 'Edit',
        input: { file_path: join(project, file) },
      });
    }
    write(chat, {
      type: 'assistant',
      timestamp: new Date(base + minute * MIN).toISOString(),
      message: { content },
    });
  };

  const stop = async (chat, prompt, finalReply = '') => {
    const started = Date.now();
    const run = hook('turn-end.js', {
      session_id: chat,
      hook_event_name: 'Stop',
      last_assistant_message: finalReply,
    });
    const took = Date.now() - started;
    const saved = await waitFor(
      async () =>
        (await savedRows(chat)).some((body) => body.startsWith(`Asked: ${prompt}`)) &&
        !existsSync(join(memoryDir, 'turns', `${chat}.json`)),
    );
    return { run, took, saved };
  };

  const stopOnly = async (chat) => {
    hook('turn-end.js', { session_id: chat, hook_event_name: 'Stop', last_assistant_message: '' });
    await waitFor(async () => !existsSync(join(memoryDir, 'turns', `${chat}.json`)));
  };

  const ask = async (chat, minute, prompt, text = `Done: ${prompt}.`, file = 'src/x.ts') => {
    askOnly(chat, minute, prompt);
    reply(chat, minute, text, file);
    return stop(chat, prompt);
  };

  const end = (chat) =>
    hook('session-end.js', { session_id: chat, hook_event_name: 'SessionEnd', reason: 'exit' });

  const start = (chat, source = 'startup') => {
    const out = hook('session-start.js', {
      session_id: chat,
      source,
      hook_event_name: 'SessionStart',
    }).stdout;
    try {
      return JSON.parse(out).hookSpecificOutput.additionalContext;
    } catch {
      return out;
    }
  };

  const note = (minute) =>
    ctx.store.insertObservations([
      {
        id: `note-${name}-${minute}`,
        sessionId: 'manual',
        project,
        kind: 'context',
        title: 'Handoff, Oct 8:',
        body: 'Handoff, Oct 8:\n- Done: retries.\n- Next: move the mailer to env.',
        files: [],
        tags: ['manual', HANDOFF_TAG],
        createdAt: base + minute * MIN,
        status: 'done',
      },
    ]);

  const seed = () =>
    ctx.store.insertObservations([
      factToObservation(
        {
          key: 'k',
          type: 'decision',
          scope: 'project',
          text: 'Retries stay at 3.',
          files: [],
          at: base,
          source: 't',
        },
        project,
      ),
    ]);

  const A4 = async () => {
    for (const [index, prompt] of [
      'add retries to the worker queue',
      'write tests for the retry backoff',
      'fix the failing test in the backoff suite',
      'release the 0.12.2 patch after the tests pass',
    ].entries()) {
      await ask('A', index * 10, prompt);
    }
  };

  return {
    project,
    askOnly,
    reply,
    stop,
    stopOnly,
    hook,
    ask,
    end,
    start,
    note,
    seed,
    A4,
    savedRows,
    log,
  };
}

const asked = (block, heading) => {
  const at = block.indexOf(heading);
  if (at === -1) return null;
  const rest = block.slice(at).split('\n\n')[0];
  return [...rest.matchAll(/asked "([^"]+)"/g)].map((match) => match[1]);
};
const A_ALL = [
  'add retries to the worker queue',
  'write tests for the retry backoff',
  'fix the failing test in the backoff suite',
  'release the 0.12.2 patch after the tests pass',
];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

try {
  {
    const w = world('case0');
    await w.seed();
    const first = await w.ask('A', 0, 'add retries to the worker queue');
    report(
      'the Stop hook returns at once, the save runs in the background',
      first.run.status === 0 && first.took < 2500,
      `${first.took} ms`,
    );
    report('the Stop hook saves the finished turn with no next message', first.saved);
    await w.ask('A', 10, 'write tests for the retry backoff');
    await w.ask('A', 20, 'fix the failing test in the backoff suite');
    await w.ask('A', 30, 'release the 0.12.2 patch after the tests pass');
    const block = w.start('C');
    report(
      'case 0: an open chat shows all its requests, the last one too',
      same(asked(block, 'Last chat ('), A_ALL),
      block,
    );
  }

  {
    const w = world('case1');
    await w.seed();
    await w.A4();
    await w.ask(
      'B',
      40,
      'rewrite the mailer to use env settings',
      'Moved SMTP settings to env and added 6 tests.',
    );
    w.end('B');
    const block = w.start('C');
    report(
      'case 1: B closed shows B, then A, and no summary that only repeats B',
      same(asked(block, 'Last chat ('), ['rewrite the mailer to use env settings']) &&
        same(asked(block, 'Chat before ('), A_ALL) &&
        !block.includes('- Summary:'),
      block,
    );
  }

  {
    const w = world('case2');
    await w.seed();
    await w.A4();
    await w.ask('B', 40, 'rewrite the mailer to use env settings');
    const block = w.start('C');
    report(
      'case 2: B left open shows B, then A',
      same(asked(block, 'Last chat ('), ['rewrite the mailer to use env settings']) &&
        same(asked(block, 'Chat before ('), A_ALL),
      block,
    );
  }

  {
    const w = world('case3');
    await w.seed();
    await w.A4();
    w.askOnly('B', 40, 'rewrite the mailer to use env settings');
    const block = w.start('C');
    report(
      'case 3: a running request shows as not finished, above the last chat',
      /Not finished yet in another chat \([A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}\):\n- asked "rewrite the mailer to use env settings"/.test(
        block,
      ) &&
        block.indexOf('Not finished yet') < block.indexOf('Last chat (') &&
        same(asked(block, 'Last chat ('), A_ALL),
      block,
    );
    const catchup = spawnSync(process.execPath, ['--no-warnings', CLI, 'catchup'], {
      cwd: w.project,
      env,
      encoding: 'utf8',
    }).stdout;
    report(
      'catchup shows the not finished request too',
      catchup.includes('Not finished yet in another chat (') &&
        catchup.includes('asked "rewrite the mailer'),
      catchup,
    );
    w.end('B');
    report(
      'the end of a chat removes its not finished request',
      !w.start('C').includes('Not finished yet'),
    );
  }

  {
    const w = world('case4');
    await w.seed();
    await w.A4();
    w.askOnly('B', 40, 'hi');
    w.reply('B', 40, 'Hi! How can I help?', null);
    await w.stopOnly('B');
    const block = w.start('C');
    report(
      'case 4: small talk is never saved and never shown as not finished',
      same(asked(block, 'Last chat ('), A_ALL) &&
        !block.includes('Not finished') &&
        !block.includes('Chat before'),
      block,
    );
  }

  {
    const w = world('case5');
    await w.seed();
    await w.A4();
    const six = [
      'start the mailer rewrite',
      'move SMTP settings to env',
      'add mailer tests',
      'fix the env loading in the mailer',
      'update the mailer docs',
      'clean up the old mailer flags',
    ];
    for (const [index, prompt] of six.entries()) await w.ask('B', 40 + index * 2, prompt);
    const block = w.start('C');
    report(
      'case 5: B with 6 requests fills the 5 lines, A is not shown',
      same(asked(block, 'Last chat ('), six.slice(1)) && !block.includes('Chat before'),
      block,
    );
  }

  {
    const w = world('case6');
    await w.seed();
    await w.A4();
    await w.ask(
      'B',
      40,
      'rewrite the mailer to use env settings',
      'Moved SMTP settings to env and added 6 tests.',
    );
    w.end('B');
    const block = w.start('A', 'resume');
    report(
      'case 6: going back to A shows B, never A itself',
      same(asked(block, 'Last chat ('), ['rewrite the mailer to use env settings']) &&
        !block.includes('Chat before'),
      block,
    );
  }

  {
    const w = world('case7a');
    await w.seed();
    await w.A4();
    await w.note(35);
    await w.ask('B', 40, 'rewrite the mailer to use env settings');
    const block = w.start('C');
    report(
      'case 7a: a note with a request after it is kept and marked',
      /Last handoff \([A-Z][a-z]{2} \d{1,2}, older than the last chat\):\n- Done: retries\./.test(
        block,
      ) && same(asked(block, 'Last chat ('), ['rewrite the mailer to use env settings']),
      block,
    );
  }

  {
    const w = world('case7b');
    await w.seed();
    await w.A4();
    await w.ask('B', 40, 'rewrite the mailer to use env settings');
    w.end('B');
    await w.note(55);
    const block = w.start('C');
    report(
      'case 7b: a note after the last request has no mark',
      /Last handoff \([A-Z][a-z]{2} \d{1,2}\):/.test(block),
      block,
    );
  }

  {
    const w = world('case7c');
    await w.seed();
    await w.A4();
    await w.note(35);
    w.askOnly('B', 40, 'rewrite the mailer to use env settings');
    const block = w.start('C');
    report(
      'a request still running after a note marks it too',
      block.includes(', older than the last chat):'),
      block,
    );
  }

  {
    const w = world('case8');
    await w.seed();
    await w.A4();
    w.askOnly('B', 40, 'hi');
    w.reply('B', 40, 'Hi!', null);
    await w.stopOnly('B');
    await w.ask('C', 45, 'what does the mailer config do', 'It sets the SMTP host in src/mail.ts.');
    const strip = (block) => block.replace(/\(context ≈ \d+ tokens\)/, '');
    const fromD = strip(w.start('D'));
    const fromE = strip(w.start('E'));
    const fromF = strip(w.start('F'));
    report(
      'case 8: empty chats and small talk never move it',
      same(asked(fromD, 'Last chat ('), ['what does the mailer config do']) &&
        same(asked(fromD, 'Chat before ('), A_ALL) &&
        fromD === fromE &&
        fromE === fromF,
      fromD,
    );
    await w.ask('D', 50, 'D asks one real thing');
    await w.ask('E', 55, 'E asks one real thing');
    await w.ask('F', 60, 'F asks one real thing');
    const fromG = w.start('G');
    report(
      'case 8: real requests push old ones out one at a time',
      (fromG.match(/^Chat before \(/gm) ?? []).length === 4 &&
        same(asked(fromG, 'Last chat ('), ['F asks one real thing']) &&
        fromG.includes('asked "release the 0.12.2 patch after the tests pass"') &&
        !fromG.includes('asked "fix the failing test'),
      fromG,
    );
    await w.ask('G', 65, 'G asks one real thing');
    const fromH = w.start('H');
    report(
      'case 8: after 5 newer requests, A drops out, and never more than 5 chats',
      (fromH.match(/^(Last chat|Chat before) \(/gm) ?? []).length === 5 &&
        !fromH.includes('release the 0.12.2'),
      fromH,
    );
  }

  {
    const w = world('turns');
    await w.seed();
    await w.ask('A', 0, 'add retries to the queue');
    await w.ask('B', 5, 'check the mailer config');
    await w.ask('A', 10, 'write tests for the queue');
    await w.ask('B', 15, 'fix the env loading');
    const block = w.start('C');
    report(
      'two chats taking turns are grouped, the newest first, each in order',
      same(asked(block, 'Last chat ('), ['check the mailer config', 'fix the env loading']) &&
        same(asked(block, 'Chat before ('), [
          'add retries to the queue',
          'write tests for the queue',
        ]),
      block,
    );
  }

  {
    const w = world('final');
    await w.seed();
    w.askOnly('A', 0, 'explain the retry rules in the queue');
    w.reply('A', 0, '', 'src/queue.ts');
    const { saved } = await w.stop(
      'A',
      'explain the retry rules in the queue',
      'The queue retries 3 times with backoff, see src/queue.ts.',
    );
    const bodies = await w.savedRows('A');
    report(
      'the final reply text is saved when the log does not have it yet',
      saved && bodies.some((body) => body.includes('retries 3 times with backoff')),
      bodies.join(' || '),
    );
    w.askOnly('A', 10, 'now add a test for the retry rules');
    report(
      'a turn saved at Stop and again at the next message is one row',
      (await w.savedRows('A')).length === 1,
    );
  }

  {
    const w = world('interrupt');
    await w.seed();
    w.askOnly('A', 0, 'refactor the retry loop in the queue');
    w.reply('A', 0, 'Started moving the loop.', 'src/queue.ts');
    report(
      'an interrupted request shows as not finished',
      w.start('C').includes('asked "refactor the retry loop'),
    );
    w.askOnly('A', 10, 'continue the refactor of the loop');
    const rows = await w.savedRows('A');
    const block = w.start('C');
    report(
      'at the next message the interrupted turn is saved and the new request is the not finished one',
      rows.some((body) => body.startsWith('Asked: refactor the retry loop')) &&
        block.includes('asked "continue the refactor of the loop"') &&
        !/Not finished[^\n]*\n- asked "refactor/.test(block),
      block,
    );
  }

  {
    const w = world('race');
    await w.seed();
    w.askOnly('B', 0, 'rename the mailer settings file');
    const earlier = Array.from({ length: 3000 }, (_, index) => {
      const at = new Date(Date.now() - 100 * MIN + index).toISOString();
      const edit = {
        type: 'tool_use',
        id: `e${index}`,
        name: 'Edit',
        input: { file_path: join(w.project, `f${index}.ts`) },
      };
      return [
        JSON.stringify({
          type: 'user',
          timestamp: at,
          message: { content: `change file number ${index} in the queue` },
        }),
        JSON.stringify({
          type: 'assistant',
          timestamp: at,
          message: { content: [{ type: 'text', text: `Changed file ${index}.` }, edit] },
        }),
      ].join('\n');
    });
    appendFileSync(w.log('B'), `${earlier.join('\n')}\n`);
    w.reply('B', 0, 'Renamed it.', 'src/mail.ts');
    const saveStarted = Date.now();
    spawnSync(process.execPath, ['--no-warnings', join(HOOKS, 'turn-end.js')], {
      cwd: w.project,
      env,
      input: JSON.stringify({
        cwd: w.project,
        session_id: 'B',
        transcript_path: w.log('B'),
        hook_event_name: 'Stop',
      }),
    });
    let missing = 0;
    let saved = false;
    for (let tries = 0; tries < 2400 && !saved; tries += 1) {
      const pending = activeRequests([w.project], 'C').length > 0;
      saved = (await w.savedRows('B')).length > 0;
      if (!pending && !saved) missing += 1;
      await sleep(25);
    }
    report(
      'while a finished turn is being saved, it is never missing from both places',
      saved && missing === 0,
      `missing ${missing}, save took ${Date.now() - saveStarted} ms`,
    );
  }

  {
    const w = world('tokens');
    recordActive('S', w.project, 'first real request about the mailer');
    const first = activeToken('S');
    recordActive('S', w.project, 'second real request about the queue');
    clearActive('S', first);
    const left = activeRequests([w.project], 'other');
    report(
      'a save never removes a newer request',
      left.length === 1 && left[0].request === 'second real request about the queue',
    );

    recordActive(
      'T',
      w.project,
      '<task-notification>\n<task-id>x</task-id>\n<summary>Background shell finished</summary>\n</task-notification>',
    );
    recordActive(
      'P',
      w.project,
      'plan the move <private>to my parents house on oak street</private> for the staging box',
    );
    const all = activeRequests([w.project], 'other', Date.now());
    report(
      'a task notice is never shown as not finished',
      !all.some((entry) => entry.sessionId === 'T'),
    );
    report(
      'private text is never kept in a not finished request',
      all.some((entry) => entry.sessionId === 'P' && !entry.request.includes('oak street')),
      JSON.stringify(all),
    );
    report(
      'a not finished request in another project is never shown',
      activeRequests(['/somewhere/else'], 'other').length === 0,
    );
    report(
      'a chat never sees its own not finished request',
      !activeRequests([w.project], 'S').some((entry) => entry.sessionId === 'S'),
    );
    report(
      'not finished requests older than 2 hours are not shown',
      activeRequests([w.project], 'other', Date.now() + 3 * 60 * MIN).length === 0,
    );
    const stale = join(memoryDir, 'active', 'S.json');
    utimesSync(
      stale,
      new Date(Date.now() - 2 * 24 * 60 * MIN),
      new Date(Date.now() - 2 * 24 * 60 * MIN),
    );
    sweepActive();
    report(
      'files older than a day are swept',
      !existsSync(stale) && activeRequests([w.project], 'other').length === 1,
    );
  }

  {
    const w = world('nofacts');
    await w.ask('A', 0, 'add retries to the worker queue');
    w.askOnly('B', 5, 'rewrite the mailer to use env settings');
    const block = w.start('C');
    report(
      'a project with no facts yet still shows the last chat and the not finished request',
      same(asked(block, 'Last chat ('), ['add retries to the worker queue']) &&
        block.includes('asked "rewrite the mailer to use env settings"'),
      block,
    );
  }

  {
    const one = world('scope-one');
    const two = world('scope-two');
    recordActive('W', two.project, 'update the shared queue config in the worktree');
    await one.seed();
    await ctx.store.linkProject(one.project, 'github.com/acme/shop');
    await ctx.store.linkProject(two.project, 'github.com/acme/shop');
    two.askOnly('W2', 0, 'move the queue settings into the shared config');
    const linked = one.start('C');
    report(
      'end to end, a not finished request in a worktree of the same project is shown at chat start',
      linked.includes('asked "move the queue settings into the shared config"'),
      linked,
    );
    report(
      'a not finished request in another folder of the same project is shown',
      activeRequests([one.project, two.project], 'other').some(
        (entry) => entry.sessionId === 'W',
      ) && activeRequests([one.project], 'other').every((entry) => entry.sessionId !== 'W'),
    );
  }

  {
    const w = world('background');
    await w.seed();
    const stopWith = async (extra) => {
      w.hook('turn-end.js', {
        session_id: 'B',
        hook_event_name: 'Stop',
        last_assistant_message: 'Started it.',
        ...extra,
      });
      for (let tries = 0; tries < 200 && existsSync(join(memoryDir, 'turns', 'B.json')); tries += 1)
        await sleep(50);
      await sleep(300);
    };
    const pending = () => activeRequests([w.project], 'C').some((entry) => entry.sessionId === 'B');
    w.askOnly('B', 0, 'run the long data migration and then update the queue file');
    w.reply('B', 0, 'Started the migration in the background.', 'src/queue.ts');
    await stopWith({
      background_tasks: [{ id: 'b1', type: 'shell', status: 'running', command: 'sleep 25' }],
    });
    report('a request whose work goes on in a background task stays not finished', pending());
    report('its turn is still saved at that Stop', (await w.savedRows('B')).length === 1);
    w.askOnly(
      'B',
      3,
      '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>',
    );
    report('a task notice turn leaves the not finished mark as it is', pending());
    await stopWith({ background_tasks: [] });
    report('a later Stop with nothing running clears it', !pending());

    w.askOnly('B', 6, 'keep checking the queue health every few minutes');
    w.reply('B', 6, 'Set a loop that checks the queue every 5 minutes.', 'src/queue.ts');
    await stopWith({ session_crons: [{ id: 'c1', cron: '*/5 * * * *' }] });
    report('a request with a scheduled loop stays not finished', pending());
    await stopWith({ background_tasks: 'not a list', session_crons: null });
    report(
      'odd Stop input still saves and clears the mark',
      !pending() && (await w.savedRows('B')).length === 2,
    );
  }

  {
    const w = world('headless');
    await w.seed();
    w.askOnly('A', 0, 'add a headless feature to the queue', { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' });
    report('a headless run writes no not finished request', !w.start('C').includes('Not finished'));
  }

  {
    const w = world('budget');
    await w.seed();
    await w.A4();
    await w.note(35);
    await w.ask('B', 40, 'rewrite the mailer to use env settings');
    w.askOnly('D', 45, 'clean up the mail templates folder');
    const maxChars = ctx.config.inject.maxChars;
    const { startFacts } = await import('../../../dist/facts/start.js');
    ctx.config.inject.maxChars = 260;
    const tight = (await startFacts(ctx, w.project, new Set(), 'C'))?.block ?? '';
    ctx.config.inject.maxChars = maxChars;
    const used = tight
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .reduce((sum, line) => sum + line.length + 1, 0);
    report('with every section, the start block stays within its budget', used <= 260, tight);
  }
} finally {
  await ctx.close();
}
