import type { RecallContext } from '../context.js';
import type { MemoryStore } from '../store/adapter.js';
import type { Observation, ObservationKind } from '../types.js';
import { readTranscript, transcriptPathFor } from './transcript.js';
import type { Turn } from './transcript.js';
import { observationsFromTurns } from './turn-extractor.js';
import { closeLandedWork } from './progress.js';
import { noteMissingVectors } from './vectors.js';
import { readCursor, writeCursor } from './cursors.js';

const LOOKUP_CHUNK = 500;

export interface FlushResult {
  observations: number;
  summary: string | null;
  lastReply: string;
}

export async function flushSession(
  ctx: RecallContext,
  sessionId: string,
  project: string,
  transcriptPath?: string,
  rebuild = false,
  finalReply = '',
): Promise<FlushResult> {
  const path = transcriptPath ?? transcriptPathFor(project, sessionId);
  const read = readTranscript(path, readCursor(sessionId));
  const turns = withFinalReply(read.turns, finalReply);
  const lastReply = turns.at(-1)?.reasoning ?? '';
  const observations = observationsFromTurns(turns, sessionId, project, ctx.config);

  const stored = rebuild
    ? new Map<string, Observation>()
    : await storedRows(ctx.store, observations);
  const changed = observations.filter((obs) => !sameRow(obs, stored.get(obs.id)));
  if (changed.length === 0) {
    await closeLandedWork(ctx.store, project);
    writeCursor(sessionId, read.nextOffset);
    return { observations: 0, summary: null, lastReply };
  }

  const previous = rebuild ? null : await ctx.store.getSession(sessionId);
  const summary = summarize(observations, previous?.summary);
  await ctx.store.upsertSession({
    id: sessionId,
    project,
    startedAt: observations[0]?.createdAt ?? Date.now(),
    summary,
  });

  await embedObservations(ctx, changed);
  await ctx.store.insertObservations(changed);
  await closeLandedWork(ctx.store, project);
  writeCursor(sessionId, read.nextOffset);
  return { observations: observations.length, summary, lastReply };
}

async function storedRows(
  store: MemoryStore,
  observations: Observation[],
): Promise<Map<string, Observation>> {
  const ids = observations.map((obs) => obs.id);
  const found = new Map<string, Observation>();
  for (let start = 0; start < ids.length; start += LOOKUP_CHUNK) {
    for (const row of await store.getObservations(ids.slice(start, start + LOOKUP_CHUNK))) {
      found.set(row.id, row);
    }
  }
  return found;
}

const sameList = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((item, index) => item === b[index]);

function sameRow(fresh: Observation, stored: Observation | undefined): boolean {
  return (
    stored !== undefined &&
    fresh.kind === stored.kind &&
    fresh.title === stored.title &&
    fresh.body === stored.body &&
    fresh.createdAt === stored.createdAt &&
    sameList(fresh.files, stored.files) &&
    sameList(fresh.tags, stored.tags)
  );
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

export { clearCursor, resetCursor, sweepCursors, sweepCursorsDaily } from './cursors.js';
