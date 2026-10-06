import { basename } from 'node:path';
import type { RecallContext } from '../context.js';
import { claimJob, finishJob, jobMark, releaseJob } from '../util/job-lock.js';
import { flushSession, resetCursor } from './flush.js';
import { readTranscript, transcriptsFor } from './transcript.js';
import { observationsFromTurns } from './turn-extractor.js';

export const REINGEST_VERSION = 1;

const SESSION_ROWS = 10_000;

export interface SessionReingest {
  sessionId: string;
  saved: number;
  replaced: number;
}

export interface ProjectReingest {
  transcripts: number;
  saved: number;
  replaced: number;
}

export async function reingestSession(
  ctx: RecallContext,
  project: string,
  path: string,
): Promise<SessionReingest> {
  const sessionId = basename(path, '.jsonl');
  const { turns, lastTimestamp } = readTranscript(path, 0);
  resetCursor(sessionId);
  const { observations: saved } = await flushSession(ctx, sessionId, project, path, true);
  if (lastTimestamp === 0) return { sessionId, saved, replaced: 0 };

  const current = new Set(
    observationsFromTurns(turns, sessionId, project, ctx.config).map((obs) => obs.id),
  );
  const stored = await ctx.store.list({ project, sessionId, limit: SESSION_ROWS });
  const stale = stored
    .filter((obs) => obs.status !== 'replaced' && obs.createdAt <= lastTimestamp)
    .filter((obs) => !current.has(obs.id))
    .map((obs) => obs.id);

  return { sessionId, saved, replaced: await ctx.store.markReplaced(stale) };
}

export async function rememberedTranscripts(
  ctx: RecallContext,
  project: string,
  paths: string[] = transcriptsFor(project),
): Promise<string[]> {
  const kept: string[] = [];
  for (const path of paths) {
    const sessionId = basename(path, '.jsonl');
    if ((await ctx.store.list({ project, sessionId, limit: 1 })).length > 0) kept.push(path);
  }
  return kept;
}

export async function reingestProject(
  ctx: RecallContext,
  project: string,
  paths: string[] = transcriptsFor(project),
  onSession: (result: SessionReingest) => void = () => {},
): Promise<ProjectReingest> {
  const total: ProjectReingest = { transcripts: paths.length, saved: 0, replaced: 0 };
  for (const path of paths) {
    const result = await reingestSession(ctx, project, path);
    total.saved += result.saved;
    total.replaced += result.replaced;
    onSession(result);
  }
  return total;
}

const JOB = 'reingest';

export function reingestDone(project: string): boolean {
  return jobMark(JOB, project) >= REINGEST_VERSION;
}

export function claimReingest(project: string, now = Date.now()): boolean {
  if (reingestDone(project)) return false;
  return claimJob(JOB, project, now);
}

export function finishReingest(project: string): void {
  finishJob(JOB, project, REINGEST_VERSION);
}

export function releaseReingest(project: string): void {
  releaseJob(JOB, project);
}
