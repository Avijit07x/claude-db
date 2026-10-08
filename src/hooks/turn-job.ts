import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR } from '../config/dir.js';
import { readJson, safeName, sweepOlderThan, writeJsonAtomic } from '../util/json-file.js';

const KEPT_FOR_MS = 24 * 60 * 60 * 1000;

export interface TurnJob {
  project: string;
  transcriptPath?: string;
  finalReply: string;
  activeToken: string | null;
}

function folder(): string {
  return join(CONFIG_DIR, 'turns');
}

function fileFor(sessionId: string): string {
  return join(folder(), `${safeName(sessionId)}.json`);
}

export function queueTurnSave(sessionId: string, job: TurnJob): void {
  writeJsonAtomic(fileFor(sessionId), job);
}

export function takeTurnSave(sessionId: string): TurnJob | null {
  const file = fileFor(sessionId);
  const job = readJson<Partial<TurnJob>>(file);
  rmSync(file, { force: true });
  const valid =
    typeof job?.project === 'string' &&
    typeof job.finalReply === 'string' &&
    (job.transcriptPath === undefined || typeof job.transcriptPath === 'string') &&
    (job.activeToken === null || typeof job.activeToken === 'string');
  return valid ? (job as TurnJob) : null;
}

export function dropTurnSave(sessionId: string): void {
  rmSync(fileFor(sessionId), { force: true });
}

export function sweepTurnSaves(now = Date.now()): void {
  sweepOlderThan(folder(), KEPT_FOR_MS, now);
}
