import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR } from '../config/index.js';
import type { Observation } from '../types.js';
import { claimJob, finishJob, jobMark, releaseJob } from '../util/job-lock.js';
import { scopeToken } from '../util/scope.js';

const JOB = 'reembed';
const FLAGS = 'vectors-missing';
const REEMBED_EVERY_MS = 6 * 60 * 60 * 1000;

const flagPath = (project: string): string =>
  join(CONFIG_DIR, FLAGS, `${scopeToken(project)}.flag`);

export function noteMissingVectors(observations: Observation[]): void {
  const projects = new Set(
    observations.filter((obs) => !obs.embedding?.length).map((obs) => obs.project),
  );
  for (const project of projects) {
    try {
      mkdirSync(join(CONFIG_DIR, FLAGS), { recursive: true });
      writeFileSync(flagPath(project), '');
    } catch {
      continue;
    }
  }
}

export const vectorsMissing = (project: string): boolean => existsSync(flagPath(project));

export function claimReembed(project: string, now = Date.now()): boolean {
  if (!vectorsMissing(project)) return false;
  if (now - jobMark(JOB, project) < REEMBED_EVERY_MS) return false;
  return claimJob(JOB, project, now);
}

export function startReembed(project: string): void {
  rmSync(flagPath(project), { force: true });
}

export function finishReembed(project: string, now = Date.now()): void {
  finishJob(JOB, project, now);
}

export function releaseReembed(project: string): void {
  releaseJob(JOB, project);
}
