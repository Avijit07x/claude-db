import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CONFIG_DIR } from '../config/index.js';
import type { Config } from '../config/index.js';
import type { RecallContext } from '../context.js';
import { readTranscript, transcriptPathFor } from './transcript.js';
import { observationsFromTurns } from './turn-extractor.js';

export interface FlushResult {
  observations: number;
  summary: string | null;
}

/**
 * Persists everything new in a session's transcript.
 *
 * Gating all writes on SessionEnd was the original design and it loses data
 * constantly: a session that is force-quit, crashes, or simply stays open for
 * days never reaches the hook, so its memory is never written. A session left
 * open for two weeks produced hundreds of observations under one id and none
 * of them searchable until it finally closed.
 *
 * Flushing incrementally removes that dependency entirely. It is only safe
 * because observation ids are content-derived: re-reading a turn rewrites the
 * same row rather than appending a duplicate.
 */
export async function flushSession(
  ctx: RecallContext,
  sessionId: string,
  project: string,
  transcriptPath?: string,
): Promise<FlushResult> {
  const path = transcriptPath ?? transcriptPathFor(project, sessionId);
  const cursor = readCursor(sessionId);

  const { turns, nextOffset } = readTranscript(path, cursor);
  if (turns.length === 0) {
    writeCursor(sessionId, nextOffset);
    return { observations: 0, summary: null };
  }

  const observations = observationsFromTurns(turns, sessionId, project, ctx.config);
  if (observations.length === 0) {
    writeCursor(sessionId, nextOffset);
    return { observations: 0, summary: null };
  }

  await embedAll(ctx, observations);
  await ctx.store.insertObservations(observations);

  const summary = summarize(observations);
  await ctx.store.upsertSession({
    id: sessionId,
    project,
    startedAt: observations[0]?.createdAt ?? Date.now(),
    summary,
  });

  writeCursor(sessionId, nextOffset);
  return { observations: observations.length, summary };
}

/**
 * Embeddings are an enhancement, never a precondition. A missing model must
 * cost semantic recall, not the memory itself.
 */
async function embedAll(
  ctx: RecallContext,
  observations: { title: string; body: string; embedding?: number[] }[],
): Promise<void> {
  try {
    const embedder = await ctx.embedder();
    if (embedder.dimensions === 0) return;

    const vectors = await embedder.embed(
      observations.map((obs) => `${obs.title}\n${obs.body}`),
    );
    observations.forEach((obs, index) => {
      const vector = vectors[index];
      if (vector && vector.length > 0) obs.embedding = vector;
    });
  } catch (error) {
    process.stderr.write(
      `[claude-db] embedding skipped: ` +
        `${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

/** Recap built from what was accomplished, not from file counts. */
function summarize(observations: { title: string }[]): string {
  const titles = observations.slice(-3).map((obs) => obs.title);
  const extra = observations.length - titles.length;
  return `${titles.join(' | ')}${extra > 0 ? ` (+${extra} earlier)` : ''}`;
}

/**
 * Per-session byte offset into the transcript.
 *
 * Stored beside the database rather than in it: this is scratch state about a
 * local file, it is worthless on another machine, and it must not sync to a
 * shared Postgres or Mongo alongside real memory.
 */
function cursorPath(sessionId: string): string {
  return join(CONFIG_DIR, 'cursors', `${sessionId.replace(/[^\w-]/g, '_')}.offset`);
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
  } catch {
    // A lost cursor only costs a redundant re-read, which is idempotent.
  }
}

export function resetCursor(sessionId: string): void {
  writeCursor(sessionId, 0);
}
