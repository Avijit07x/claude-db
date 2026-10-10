import {
  claimReembed,
  claimReingest,
  claimScrub,
  reingestDone,
  releaseReembed,
  releaseReingest,
  releaseScrub,
} from '../capture/index.js';
import { FACTS_JOB } from '../facts/distill.js';
import { claimJob, jobMark, releaseJob } from '../util/job-lock.js';
import { CLI, PICK_WORKER, runDetached } from './detached.js';

const FACTS_EVERY_MS = 60 * 60 * 1000;

export function startBackgroundWork(project: string, database: string, now = Date.now()): void {
  if (claimScrub(database, now)) {
    runDetached(CLI, ['redact', '--background'], project, () => releaseScrub(database));
    return;
  }
  if (claimReingest(project, now)) {
    runDetached(CLI, ['flush', '--repair'], project, () => releaseReingest(project));
    return;
  }
  if (!reingestDone(project)) return;
  if (claimReembed(project, now)) {
    runDetached(CLI, ['reembed', '--project', '--background'], project, () =>
      releaseReembed(project),
    );
    return;
  }
  if (now - jobMark(FACTS_JOB, project) < FACTS_EVERY_MS) return;
  if (!claimJob(FACTS_JOB, project, now)) return;
  runDetached(CLI, ['distill', '--backfill'], project, () => releaseJob(FACTS_JOB, project));
}

export function distillInBackground(project: string, sessionId: string): void {
  runDetached(CLI, ['distill', '--session', sessionId], project, () => {});
}

export function pickInBackground(project: string, sessionId: string, token: string): void {
  runDetached(PICK_WORKER, [sessionId, token], project, () => {});
}
