import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CONFIG_DIR } from '../config/index.js';
import type { RecallContext } from '../context.js';
import type { Observation, ObservationKind } from '../types.js';
import { readTranscript, sessionIdsOnDisk, transcriptPathFor } from './transcript.js';
import { observationsFromTurns } from './turn-extractor.js';
import { closeLandedWork } from './progress.js';

export interface FlushResult {
  observations: number;
  summary: string | null;
}

export async function flushSession(
  ctx: RecallContext,
  sessionId: string,
  project: string,
  transcriptPath?: string,
  rebuild = false,
): Promise<FlushResult> {
  const path = transcriptPath ?? transcriptPathFor(project, sessionId);
  const cursor = readCursor(sessionId);

  const { turns, nextOffset } = readTranscript(path, cursor);
  await closeLandedWork(ctx.store, project);
  if (turns.length === 0) {
    writeCursor(sessionId, nextOffset);
    return { observations: 0, summary: null };
  }

  const observations = observationsFromTurns(turns, sessionId, project, ctx.config);
  if (observations.length === 0) {
    writeCursor(sessionId, nextOffset);
    return { observations: 0, summary: null };
  }

  await embedObservations(ctx, observations);
  await ctx.store.insertObservations(observations);

  const previous = rebuild ? null : await ctx.store.getSession(sessionId);
  const summary = summarize(observations, previous?.summary);
  await ctx.store.upsertSession({
    id: sessionId,
    project,
    startedAt: observations[0]?.createdAt ?? Date.now(),
    summary,
  });

  writeCursor(sessionId, nextOffset);
  return { observations: observations.length, summary };
}

export async function embedObservations(
  ctx: RecallContext,
  observations: Observation[],
): Promise<void> {
  try {
    const embedder = await ctx.embedder();
    if (embedder.dimensions === 0) return;

    // ponytail: chunked because peak memory scales with the batch handed to one
    // forward pass, not with the database. Measured on all-MiniLM-L6-v2, 512-token
    // bodies: 8 -> 0.8GB, 16 -> 1.3GB, 32 -> 2.4GB, 64 -> 4.5GB, all at identical
    // wall-clock. Batching buys nothing on CPU, so keep it small.
    const size = ctx.config.embeddings.batchSize;
    for (let start = 0; start < observations.length; start += size) {
      const chunk = observations.slice(start, start + size);
      const vectors = await embedder.embed(chunk.map((obs) => `${obs.title}\n${obs.body}`));
      chunk.forEach((obs, index) => {
        const vector = vectors[index];
        if (vector && vector.length > 0) {
          obs.embedding = vector;
          obs.embedder = embedder.id;
        }
      });
    }
  } catch (error) {
    process.stderr.write(
      `[claude-db] embedding skipped: ` +
        `${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

const KIND_RANK: Record<ObservationKind, number> = {
  decision: 0,
  deadend: 1,
  preference: 2,
  bugfix: 3,
  pattern: 4,
  context: 5,
};

export function summarize(observations: Observation[], previous?: string): string {
  const kept = previous ? previous.split(' | ').filter(Boolean) : [];

  for (const obs of [...observations].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind])) {
    if (kept.length >= 3) break;
    if (!kept.includes(obs.title)) kept.push(obs.title);
  }
  return kept.join(' | ');
}

function cursorName(sessionId: string): string {
  return `${sessionId.replace(/[^\w-]/g, '_')}.offset`;
}

function cursorPath(sessionId: string): string {
  return join(CONFIG_DIR, 'cursors', cursorName(sessionId));
}

function readCursor(sessionId: string): number {
  try {
    const value = Number.parseInt(readFileSync(cursorPath(sessionId), 'utf8'), 10);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

function writeCursor(sessionId: string, offset: number): void {
  const path = cursorPath(sessionId);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, String(offset), 'utf8');
  } catch {}
}

export function resetCursor(sessionId: string): void {
  writeCursor(sessionId, 0);
}

export function clearCursor(sessionId: string): void {
  rmSync(cursorPath(sessionId), { force: true });
  rmSync(cursorPath(sessionId).replace(/\.offset$/, '.shown'), { force: true });
}

export function sweepCursors(): number {
  const dir = join(CONFIG_DIR, 'cursors');
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return 0;
  }

  const live = new Set(sessionIdsOnDisk().map((id) => id.replace(/[^\w-]/g, '_')));
  let removed = 0;
  for (const file of files) {
    const match = /^(.+)\.(offset|shown)$/.exec(file);
    if (!match?.[1] || live.has(match[1])) continue;
    rmSync(join(dir, file), { force: true });
    removed += 1;
  }
  return removed;
}
