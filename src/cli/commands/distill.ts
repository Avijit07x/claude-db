import { setConfigValue } from '../../config/index.js';
import type { RecallContext } from '../../context.js';
import { createContext } from '../../context.js';
import { distillUsage } from '../../facts/budget.js';
import { importClaudeMemory } from '../../facts/claude-memory.js';
import {
  FACTS_JOB,
  backfill,
  distillSession,
  factCounts,
  pendingSessions,
} from '../../facts/distill.js';
import { finishJob, releaseJob } from '../../util/job-lock.js';
import { resolveProject } from '../../util/project.js';

export async function cmdDistill(argv: (string | undefined)[]): Promise<void> {
  const [first] = argv;
  if (first === 'on' || first === 'off') {
    setConfigValue('distill', 'enabled', first === 'on');
    console.log(
      first === 'on'
        ? 'Chats will be turned into facts after they end, with one small Haiku call each.'
        : 'Turning chats into facts is off. Chats are still recorded; nothing calls Claude.',
    );
    return;
  }

  const project = resolveProject(undefined);
  if (first === '--backfill') {
    await runBackfill(project);
    return;
  }

  const ctx = await createContext();
  try {
    const session = argv[argv.indexOf('--session') + 1];
    if (first === '--session' && session) {
      if (ctx.config.distill.enabled) await distillSession(ctx, project, session);
      return;
    }
    await printStatus(ctx, project);
  } finally {
    await ctx.close();
  }
}

async function runBackfill(project: string): Promise<void> {
  try {
    const ctx = await createContext();
    try {
      await importClaudeMemory(ctx, project);
      if (ctx.config.distill.enabled) await backfill(ctx, project);
    } finally {
      await ctx.close();
    }
  } catch (error) {
    releaseJob(FACTS_JOB, project);
    throw error;
  }
  finishJob(FACTS_JOB, project, Date.now());
}

async function printStatus(ctx: RecallContext, project: string): Promise<void> {
  const { distill } = ctx.config;
  const usage = distillUsage();
  const facts = await factCounts(ctx, project);

  console.log(`distill  : ${distill.enabled ? 'on' : 'off'} (${distill.model})`);
  console.log(`today    : ${usage.used} of ${distill.dailyLimit} calls used`);
  if (usage.pausedUntil > Date.now()) {
    console.log(
      `paused   : until ${new Date(usage.pausedUntil).toISOString()} after a failed call`,
    );
  }
  console.log(`facts    : ${facts.project} for this project, ${facts.you} about you`);
  console.log(
    `waiting  : ${(await pendingSessions(ctx, project)).length} chat(s) not yet turned into facts`,
  );
  if (!distill.enabled) console.log('\nTurn it on with: claude-db distill on');
}
