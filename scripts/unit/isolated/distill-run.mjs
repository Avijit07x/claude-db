import '../../lib/require-isolated.mjs';
import { randomUUID } from 'node:crypto';
import { expirePause } from '../../lib/budget-files.mjs';
import { report } from '../../lib/isolated.mjs';
import { ConfigSchema } from '../../../dist/config/index.js';
import { createContext } from '../../../dist/context.js';
import { distillUsage } from '../../../dist/facts/budget.js';
import { backfill, distillSession, pendingSessions } from '../../../dist/facts/distill.js';
import { factId, youScope } from '../../../dist/facts/model.js';
import { describePause } from '../../../dist/util/daily-budget.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const FAILURE = 'exited with code 1: error: not logged in';
const near = (ms, target) => Math.abs(ms - target) < 60_000;
const now = Date.now();
const defaults = ConfigSchema.parse({});
const open = (dailyLimit) =>
  createContext({
    distill: { ...defaults.distill, dailyLimit },
    embeddings: { ...defaults.embeddings, provider: 'builtin' },
  });

const row = (project, sessionId, body, at) => ({
  id: randomUUID(),
  sessionId,
  project,
  kind: 'pattern',
  title: body.split('\n')[0],
  body,
  files: [],
  tags: [],
  createdAt: at,
  status: 'done',
});

async function chat(ctx, project, sessionId, body, at) {
  await ctx.store.insertObservations([row(project, sessionId, body, at)]);
  await ctx.store.upsertSession({ id: sessionId, project, startedAt: at, summary: 'raw summary' });
}

let lastPrompt = '';
const reply = (lines) => async (prompt) => {
  lastPrompt = prompt;
  return lines === null ? { ok: false, reason: FAILURE } : { ok: true, stdout: lines.join('\n') };
};
const byId = async (ctx, ids) =>
  new Map((await ctx.store.getObservations(ids)).map((obs) => [obs.id, obs]));

const shop = '/p/shop';
const ctx = await open(5);
try {
  await chat(
    ctx,
    shop,
    'chat-a',
    'Asked: timers fire too early\n\nSet all 12 timers to 1.1s.',
    now - 3 * DAY,
  );
  const first = await distillSession(
    ctx,
    shop,
    'chat-a',
    reply([
      '{"op":"set","key":"plain-text","type":"rule","scope":"you","text":"Reply in plain text, never in tables."}',
      '{"op":"set","key":"timers","type":"decision","text":"All 12 timers fire after 1.1s.","why":"They fired too early."}',
      '{"op":"set","key":"worker-retries","type":"todo","text":"Ask which retries to change on the worker queue."}',
    ]),
  );
  const ids = [
    factId(youScope(), 'plain-text'),
    factId(shop, 'timers'),
    factId(shop, 'worker-retries'),
  ];
  const facts = await byId(ctx, ids);
  report(
    'a chat becomes facts',
    first.outcome === 'distilled' && first.set === 3,
    JSON.stringify(first),
  );
  report('the model was shown the chat', lastPrompt.includes('Set all 12 timers to 1.1s.'));
  report(
    'a rule about the user is stored under the user',
    facts.get(ids[0])?.project === youScope(),
  );
  report(
    'a decision keeps its reason',
    facts.get(ids[1])?.body.includes('Why: They fired too early.'),
  );
  const done = await ctx.store.getSession('chat-a');
  report(
    'the chat is marked done, with a summary built from its facts',
    done?.distilledAt > 0 &&
      done.summary ===
        'Reply in plain text, never in tables. | All 12 timers fire after 1.1s. | Ask which retries to change on the worker queue.',
    done?.summary,
  );

  await chat(ctx, shop, 'chat-b', 'Asked: timers again\n\nMade them 1.2s instead.', now - 2 * DAY);
  await distillSession(
    ctx,
    shop,
    'chat-b',
    reply([
      '{"op":"set","key":"timers","type":"decision","text":"All 12 timers fire after 1.2s."}',
      '{"op":"retire","key":"worker-retries"}',
    ]),
  );
  const updated = await byId(ctx, ids);
  report(
    'the model is shown what is already known',
    lastPrompt.includes('timers [decision, project] All 12 timers fire after 1.1s.'),
  );
  report(
    'an updated fact replaces the old one in place',
    updated.get(ids[1])?.title === 'All 12 timers fire after 1.2s.',
  );
  report('a finished todo is retired, not deleted', updated.get(ids[2])?.status === 'replaced');

  await chat(ctx, shop, 'chat-c', 'Asked: ok\n\nDone.', now - DAY);
  const junk = await distillSession(ctx, shop, 'chat-c', reply(['Nothing worth keeping.']));
  const junkSession = await ctx.store.getSession('chat-c');
  report(
    'a reply with nothing usable stores nothing and keeps the old summary',
    junk.set === 0 && junkSession?.distilledAt > 0 && junkSession.summary === 'raw summary',
  );

  await chat(ctx, shop, 'chat-scope', 'Asked: resume\n\nWrote the resume summary.', now - DAY);
  await distillSession(
    ctx,
    shop,
    'chat-scope',
    reply([
      '{"op":"set","key":"career","type":"fact","scope":"you","text":"Has ten years of backend experience."}',
    ]),
  );
  const career = await byId(ctx, [factId(shop, 'career'), factId(youScope(), 'career')]);
  report(
    'only rules may follow the user everywhere; other facts stay in the project',
    career.has(factId(shop, 'career')) && !career.has(factId(youScope(), 'career')),
  );

  const empty = await distillSession(ctx, shop, 'chat-without-rows', reply(['{}']));
  report('a chat with no rows needs no call', empty.outcome === 'empty');
} finally {
  await ctx.close();
}

const usedSoFar = distillUsage().used;
const capped = await open(usedSoFar);
try {
  await chat(capped, shop, 'chat-x', 'Asked: more\n\nMore work.', now);
  const over = await distillSession(capped, shop, 'chat-x', reply(['{}']));
  report(
    'the daily limit is respected',
    over.outcome === 'over-budget' && distillUsage().used === usedSoFar,
  );
} finally {
  await capped.close();
}

const big = '/p/big';
const windowed = await open(30);
try {
  const turns = Array.from({ length: 50 }, (_, i) =>
    row(big, 'chat-big', `Asked: step ${i}\n\n${'detail '.repeat(130)}`, now - DAY + i),
  );
  await windowed.store.insertObservations(turns);
  await windowed.store.upsertSession({
    id: 'chat-big',
    project: big,
    startedAt: now - DAY,
    summary: 'x',
  });
  const prompts = [];
  const result = await distillSession(windowed, big, 'chat-big', async (prompt) => {
    prompts.push(prompt);
    return {
      ok: true,
      stdout: `{"op":"set","key":"window-${prompts.length}","type":"fact","text":"Fact from window ${prompts.length}."}`,
    };
  });
  report(
    'a long chat is read in windows, one call each',
    prompts.length === 2 && result.set === 2,
    `${prompts.length} calls`,
  );
  report('the first window starts at the start of the chat', prompts[0]?.includes('Asked: step 0'));
  report(
    'a later window sees what the earlier one learned',
    prompts[1]?.includes('window-1 [fact, project] Fact from window 1.'),
  );
  const before = distillUsage().used;
  const tight = await open(before + 1);
  try {
    await tight.store.upsertSession({
      id: 'chat-big',
      project: big,
      startedAt: now - DAY,
      summary: 'x',
    });
    let calls = 0;
    const over = await distillSession(tight, big, 'chat-big', async () => {
      calls += 1;
      return { ok: true, stdout: '' };
    });
    report(
      'a chat that does not fit in what is left of the day is not started',
      over.outcome === 'over-budget' && calls === 0,
    );
  } finally {
    await tight.close();
  }
} finally {
  await windowed.close();
}

const store = '/p/backfill';
const roomy = await open(distillUsage().used + 2);
try {
  await chat(roomy, store, 'old-1', 'Asked: one\n\nOne.', now - 2 * DAY);
  await chat(roomy, store, 'old-2', 'Asked: two\n\nTwo.', now - DAY);
  await chat(roomy, store, 'ancient', 'Asked: three\n\nThree.', now - 200 * DAY);
  const pending = await pendingSessions(roomy, store);
  report(
    'backfill goes newest first and skips chats past the window',
    pending.join() === 'old-2,old-1',
    pending.join(),
  );
  const result = await backfill(
    roomy,
    store,
    reply(['{"op":"set","key":"k","type":"fact","text":"A fact."}']),
  );
  report(
    'backfill distils what the budget allows',
    result.distilled === 2 && result.stopped === 'done',
    JSON.stringify(result),
  );
  await chat(roomy, store, 'old-3', 'Asked: four\n\nFour.', now);
  const stopped = await backfill(roomy, store, reply(['{}']));
  report(
    'and stops when the day is used up',
    stopped.stopped === 'over-budget' && stopped.remaining === 1,
    JSON.stringify(stopped),
  );
} finally {
  await roomy.close();
}

const failing = await open(50);
try {
  await chat(failing, shop, 'chat-d', 'Asked: d\n\nD.', now);
  const failed = await distillSession(failing, shop, 'chat-d', reply(null));
  report('a failed call is reported', failed.outcome === 'failed');
  const first = distillUsage();
  report(
    'and pauses distilling for an hour',
    first.failures === 1 && near(first.pausedUntil - Date.now(), HOUR),
    JSON.stringify(first),
  );
  report(
    'and keeps the reason, which status shows',
    first.lastFailure?.reason === FAILURE &&
      describePause(first)?.endsWith(`after a failed call: ${FAILURE}`),
    describePause(first) ?? 'not paused',
  );
  const paused = await distillSession(failing, shop, 'chat-d', reply(['{}']));
  report('nothing calls Claude while paused', paused.outcome === 'over-budget');
  report(
    'the failed chat is left for later',
    (await failing.store.getSession('chat-d'))?.distilledAt === undefined,
  );
  expirePause('distill');
  await distillSession(failing, shop, 'chat-d', reply(null));
  const second = distillUsage();
  report(
    'a second failure in a row pauses it for six hours',
    second.failures === 2 && near(second.pausedUntil - Date.now(), 6 * HOUR),
    JSON.stringify(second),
  );
  report(
    'and status counts the failures',
    describePause(second)?.includes('after 2 failed calls in a row'),
  );
} finally {
  await failing.close();
}

const recovering = await open(50);
try {
  await chat(recovering, shop, 'chat-e', 'Asked: e\n\nE.', now);
  expirePause('distill');
  const recovered = await distillSession(recovering, shop, 'chat-e', reply(['{}']));
  const after = distillUsage();
  report(
    'a working call after failures clears the streak and the reason',
    recovered.outcome === 'distilled' && after.failures === 0 && after.lastFailure === null,
    JSON.stringify({ outcome: recovered.outcome, ...after }),
  );
} finally {
  await recovering.close();
}
