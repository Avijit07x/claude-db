import { createHash } from 'node:crypto';
import type { RecallContext } from '../context.js';
import type { Observation, ObservationKind } from '../types.js';
import { readTranscript, transcriptPathFor } from './transcript.js';
import type { Turn } from './transcript.js';
import { observationsFromTurns } from './turn-extractor.js';
import { closeLandedWork } from './progress.js';
import { noteMissingVectors } from './vectors.js';
import { advanceCursor, readCursor, readWritten, writeWritten } from './cursors.js';
import { withFlushLock } from './flush-lock.js';
import type { FlushLockOptions } from './flush-lock.js';

export interface FlushResult {
  observations: number;
  summary: string | null;
  lastReply: string;
  skipped?: boolean;
}

export async function flushSession(
  ctx: RecallContext,
  sessionId: string,
  project: string,
  transcriptPath?: string,
  rebuild = false,
  finalReply = '',
  lock: FlushLockOptions = {},
): Promise<FlushResult> {
  const result = await withFlushLock(
    sessionId,
    () => flushUnlocked(ctx, sessionId, project, transcriptPath, rebuild, finalReply),
    lock,
  );
  if (result.ran) return result.value;
  return { observations: 0, summary: null, lastReply: '', skipped: true };
}

async function flushUnlocked(
  ctx: RecallContext,
  sessionId: string,
  project: string,
  transcriptPath: string | undefined,
  rebuild: boolean,
  finalReply: string,
): Promise<FlushResult> {
  const path = transcriptPath ?? transcriptPathFor(project, sessionId);
  const cursor = readCursor(sessionId);

  const read = readTranscript(path, cursor);
  const { nextOffset } = read;
  const turns = withFinalReply(read.turns, finalReply);
  const lastReply = turns.at(-1)?.reasoning ?? '';
  if (turns.length === 0) {
    await closeLandedWork(ctx.store, project);
    advanceCursor(sessionId, cursor, nextOffset);
    return { observations: 0, summary: null, lastReply };
  }

  const observations = observationsFromTurns(turns, sessionId, project, ctx.config);
  if (observations.length === 0) {
    await closeLandedWork(ctx.store, project);
    advanceCursor(sessionId, cursor, nextOffset);
    return { observations: 0, summary: null, lastReply };
  }

  const written = rebuild ? new Map<string, string>() : readWritten(sessionId);
  const prints = new Map(observations.map((obs) => [obs.id, printOf(obs)]));
  const fresh = observations.filter((obs) => written.get(obs.id) !== prints.get(obs.id));
  if (fresh.length === 0) {
    await closeLandedWork(ctx.store, project);
    advanceCursor(sessionId, cursor, nextOffset);
    return { observations: 0, summary: null, lastReply };
  }
  await embedObservations(ctx, fresh);
  await ctx.store.insertObservations(fresh);
  writeWritten(sessionId, prints);
  await closeLandedWork(ctx.store, project);

  const previous = rebuild ? null : await ctx.store.getSession(sessionId);
  const summary = summarize(observations, previous?.summary);
  await ctx.store.upsertSession({
    id: sessionId,
    project,
    startedAt: observations[0]?.createdAt ?? Date.now(),
    summary,
  });

  advanceCursor(sessionId, cursor, nextOffset);
  return { observations: observations.length, summary, lastReply };
}

export async function embedObservations(
  ctx: RecallContext,
  observations: Observation[],
): Promise<void> {
  if (observations.length === 0) return;
  try {
    const embedder = await ctx.embedder();
    if (embedder.dimensions === 0) {
      if (ctx.config.embeddings.provider !== 'none') noteMissingVectors(observations);
      return;
    }

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
    const stored = ctx.store.storedVectorDims?.() ?? null;
    noteMissingVectors(observations, stored !== null && stored !== embedder.dimensions);
  } catch (error) {
    noteMissingVectors(observations);
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

function withFinalReply(turns: Turn[], finalReply: string): Turn[] {
  const reply = finalReply.trim();
  const last = turns.at(-1);
  if (!last || !reply || last.reasoning.includes(reply)) return turns;
  const reasoning = last.reasoning ? `${last.reasoning}\n${reply}` : reply;
  return [...turns.slice(0, -1), { ...last, reasoning }];
}

export function summarize(observations: Observation[], previous?: string): string {
  const kept = previous ? previous.split(' | ').filter(Boolean) : [];

  for (const obs of [...observations].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind])) {
    if (kept.length >= 3) break;
    if (!kept.includes(obs.title)) kept.push(obs.title);
  }
  return kept.join(' | ');
}

const printOf = (obs: Observation): string =>
  createHash('sha256').update(JSON.stringify(obs)).digest('base64url');

export { clearCursor, resetCursor, sweepCursors, sweepCursorsDaily } from './cursors.js';
