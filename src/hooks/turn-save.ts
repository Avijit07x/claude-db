#!/usr/bin/env node
import { createContext } from '../context.js';
import { silenceSqliteWarning } from '../util/warnings.js';
import { runHook } from './payload.js';
import { saveQueuedTurn } from './save-turn.js';

silenceSqliteWarning();

await runHook(async () => {
  const [sessionId] = process.argv.slice(2);
  if (!sessionId) return;
  await saveQueuedTurn(sessionId, async (work) => {
    const ctx = await createContext();
    try {
      return await work(ctx);
    } finally {
      await ctx.close();
    }
  });
});
