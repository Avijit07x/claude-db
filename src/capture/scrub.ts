import type { RecallContext } from '../context.js';
import { eachObservation } from '../store/each.js';
import type { Observation } from '../types.js';
import { claimJob, finishJob, jobMark, releaseJob } from '../util/job-lock.js';
import { embedObservations } from './flush.js';
import { redact } from './redact.js';

export const REDACT_VERSION = 1;
const JOB = 'redact';
const SESSION_LIMIT = 100_000;

export interface ScrubResult {
  observations: number;
  sessions: number;
}

function redacted(obs: Observation): Observation | null {
  const title = redact(obs.title);
  const body = redact(obs.body);
  return title === obs.title && body === obs.body ? null : { ...obs, title, body };
}

export async function scrubSecrets(ctx: RecallContext, now = Date.now()): Promise<ScrubResult> {
  let observations = 0;
  await eachObservation(ctx, {}, async (batch) => {
    const changed = batch.map(redacted).filter((obs): obs is Observation => obs !== null);
    if (changed.length === 0) return;
    await embedObservations(ctx, changed);
    await ctx.store.insertObservations(changed);
    observations += changed.length;
  });

  let sessions = 0;
  for (const { project } of await ctx.store.listProjects()) {
    for (const session of await ctx.store.recentSessions(project, SESSION_LIMIT)) {
      if (!session.summary) continue;
      const summary = redact(session.summary);
      if (summary === session.summary) continue;
      await ctx.store.upsertSession({ ...session, summary, updatedAt: now });
      sessions += 1;
    }
  }
  return { observations, sessions };
}

export function scrubDone(database: string): boolean {
  return jobMark(JOB, database) >= REDACT_VERSION;
}

export function claimScrub(database: string, now = Date.now()): boolean {
  return !scrubDone(database) && claimJob(JOB, database, now);
}

export function finishScrub(database: string): void {
  finishJob(JOB, database, REDACT_VERSION);
}

export function releaseScrub(database: string): void {
  releaseJob(JOB, database);
}
