#!/usr/bin/env node
import { clearActive } from '../capture/active.js';
import { flushSession } from '../capture/index.js';
import { createContext } from '../context.js';
import { silenceSqliteWarning } from '../util/warnings.js';
import { runHook } from './payload.js';
import { takeTurnSave } from './turn-job.js';

silenceSqliteWarning();

await runHook(async () => {
  const [sessionId] = process.argv.slice(2);
  if (!sessionId) return;
  const job = takeTurnSave(sessionId);
  if (!job) return;

  const ctx = await createContext();
  try {
    await flushSession(ctx, sessionId, job.project, job.transcriptPath, false, job.finalReply);
  } finally {
    await ctx.close();
  }
  if (job.activeToken) clearActive(sessionId, job.activeToken);
});
