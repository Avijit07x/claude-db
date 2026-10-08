import { randomUUID } from 'node:crypto';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR } from '../config/dir.js';
import { readJson, safeName, sweepOlderThan, writeJsonAtomic } from '../util/json-file.js';
import { isSearchable, readablePrompt } from '../util/prompt.js';
import { redact } from './redact.js';
import { isSyntheticPrompt } from './transcript.js';
import { clipAsked, stripPrivate } from './turn-extractor.js';

const SHOWN_FOR_MS = 2 * 60 * 60 * 1000;
const KEPT_FOR_MS = 24 * 60 * 60 * 1000;
const SHOWN_AT_MOST = 2;

export interface ActiveRequest {
  sessionId: string;
  project: string;
  request: string;
  askedAt: number;
  token: string;
}

function folder(): string {
  return join(CONFIG_DIR, 'active');
}

function fileFor(sessionId: string): string {
  return join(folder(), `${safeName(sessionId)}.json`);
}

function readActive(file: string): ActiveRequest | null {
  const value = readJson<Partial<ActiveRequest>>(file);
  const valid =
    typeof value?.sessionId === 'string' &&
    typeof value.project === 'string' &&
    typeof value.request === 'string' &&
    typeof value.askedAt === 'number' &&
    typeof value.token === 'string';
  return valid ? (value as ActiveRequest) : null;
}

export function recordActive(
  sessionId: string,
  project: string,
  prompt: string,
  now = Date.now(),
): void {
  if (isSyntheticPrompt(prompt)) return;
  const text = readablePrompt(stripPrivate(prompt));
  if (!isSearchable(text)) {
    clearActive(sessionId);
    return;
  }
  const request = clipAsked(redact(text));
  writeJsonAtomic(fileFor(sessionId), {
    sessionId,
    project,
    request,
    askedAt: now,
    token: randomUUID(),
  } satisfies ActiveRequest);
}

export function activeToken(sessionId: string): string | null {
  return readActive(fileFor(sessionId))?.token ?? null;
}

export function clearActive(sessionId: string, token?: string): void {
  const file = fileFor(sessionId);
  if (token !== undefined && readActive(file)?.token !== token) return;
  rmSync(file, { force: true });
}

export function activeRequests(
  projects: readonly string[],
  current: string | undefined,
  now = Date.now(),
): ActiveRequest[] {
  let names: string[];
  try {
    names = readdirSync(folder());
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith('.json'))
    .map((name) => readActive(join(folder(), name)))
    .filter(
      (entry): entry is ActiveRequest =>
        entry !== null &&
        projects.includes(entry.project) &&
        entry.sessionId !== current &&
        now - entry.askedAt <= SHOWN_FOR_MS,
    )
    .sort((a, b) => b.askedAt - a.askedAt)
    .slice(0, SHOWN_AT_MOST);
}

export function sweepActive(now = Date.now()): void {
  sweepOlderThan(folder(), KEPT_FOR_MS, now);
}
