#!/usr/bin/env node
import { createContext } from '../context.js';
import { runHook } from '../hooks/payload.js';
import { withCost } from '../hooks/prompt-recall.js';
import { pauseBudget } from '../util/daily-budget.js';
import { silenceSqliteWarning } from '../util/warnings.js';
import { finishPick, takeJob } from './pending.js';
import { PICK_BUDGET, PICK_PAUSE_MS, headlessPicker, pickMemories } from './run.js';

silenceSqliteWarning();

await runHook(async () => {
  const [sessionId, token] = process.argv.slice(2);
  if (!sessionId || !token) return;
  const job = takeJob(sessionId, token);
  if (!job) return;

  const ctx = await createContext();
  try {
    const outcome = await pickMemories(ctx, job, headlessPicker(ctx.config));
    if (outcome.kind === 'picked') {
      finishPick(sessionId, token, { text: withCost(outcome.block), ids: outcome.ids });
    } else if (outcome.kind === 'failed') {
      pauseBudget(PICK_BUDGET, PICK_PAUSE_MS);
      if (job.fallback) finishPick(sessionId, token, job.fallback);
    }
  } finally {
    await ctx.close();
  }
});
