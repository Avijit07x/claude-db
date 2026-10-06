import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  claimReingest,
  claimScrub,
  reingestDone,
  releaseReingest,
  releaseScrub,
} from '../capture/index.js';
import { FACTS_JOB } from '../facts/distill.js';
import { claimJob, jobMark, releaseJob } from '../util/job-lock.js';

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = resolve(DIST, 'cli', 'index.js');
const PICK_WORKER = resolve(DIST, 'pick', 'worker.js');

const FACTS_EVERY_MS = 60 * 60 * 1000;

function runDetached(script: string, args: string[], cwd: string, release: () => void): void {
  try {
    spawn(process.execPath, [script, ...args], { cwd, detached: true, stdio: 'ignore' })
      .on('error', release)
      .unref();
  } catch {
    release();
  }
}

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
