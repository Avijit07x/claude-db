import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CONFIG_DIR } from '../config/index.js';
import type { RecallContext } from '../context.js';
import type { Observation, ObservationKind } from '../types.js';
import { readTranscript, sessionIdsOnDisk, transcriptPathFor } from './transcript.js';
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
  /**
   * Discards the stored recap instead of extending it. A manual flush re-reads
   * the whole transcript, so the summary can be rebuilt from scratch — and
   * after an upgrade it has to be, or the recap injected at every SessionStart
   * keeps quoting titles the new extractor would no longer write.
   */
  rebuild = false,
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

/**
 * Embeddings are an enhancement, never a precondition. A missing model must
 * cost semantic recall, not the memory itself.
 */
export async function embedObservations(
  ctx: RecallContext,
  observations: Observation[],
): Promise<void> {
  try {
    const embedder = await ctx.embedder();
    if (embedder.dimensions === 0) return;

    const vectors = await embedder.embed(
      observations.map((obs) => `${obs.title}\n${obs.body}`),
    );
    observations.forEach((obs, index) => {
      const vector = vectors[index];
      if (vector && vector.length > 0) {
        obs.embedding = vector;
        // Stamped so search can refuse to compare across embedding spaces and
        // `reembed` can tell which rows are already current.
        obs.embedder = embedder.id;
      }
    });
  } catch (error) {
    process.stderr.write(
      `[claude-db] embedding skipped: ` +
        `${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

/** Least forgettable first. What a session is *for* is usually a decision. */
const KIND_RANK: Record<ObservationKind, number> = {
  decision: 0,
  deadend: 1,
  preference: 2,
  bugfix: 3,
  pattern: 4,
  context: 5,
};

/**
 * Recap of the session so far, and the only thing SessionStart injects.
 *
 * Taking the last three titles of the current flush was close to useless once
 * capture became incremental: a flush usually carries a single turn, so the
 * recap of an entire day's session was whatever happened to be typed last.
 * Carrying the previous summary forward makes it cover the session, and
 * ranking by kind keeps a decision over the build command that followed it.
 *
 * ponytail: first three win, so a decision made late in a long session does
 * not displace an earlier one. Rank the session's stored observations instead
 * if that turns out to matter.
 */
export function summarize(observations: Observation[], previous?: string): string {
  const kept = previous ? previous.split(' | ').filter(Boolean) : [];

  for (const obs of [...observations].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind])) {
    if (kept.length >= 3) break;
    if (!kept.includes(obs.title)) kept.push(obs.title);
  }
  return kept.join(' | ');
}

/**
 * Per-session byte offset into the transcript.
 *
 * Stored beside the database rather than in it: this is scratch state about a
 * local file, it is worthless on another machine, and it must not sync to a
 * shared Postgres or Mongo alongside real memory.
 */
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
  } catch {
    // A lost cursor only costs a redundant re-read, which is idempotent.
  }
}

export function resetCursor(sessionId: string): void {
  writeCursor(sessionId, 0);
}

/** The session is over; its offset is scratch state nothing will read again. */
export function clearCursor(sessionId: string): void {
  rmSync(cursorPath(sessionId), { force: true });
}

/**
 * Drops cursors whose transcript no longer exists anywhere.
 *
 * Clearing on SessionEnd only covers sessions that end after it shipped, so a
 * machine that has been running this for a while keeps a file per session it
 * ever saw. Harmless, and untidy in a way that makes the rest look unmaintained.
 *
 * Checked against every transcript on disk rather than this project's, because
 * cursors are keyed by session alone: sweeping on a per-project basis would
 * delete another project's live cursor and cost it a full re-read.
 */
export function sweepCursors(): number {
  const dir = join(CONFIG_DIR, 'cursors');
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return 0;
  }

  const live = new Set(sessionIdsOnDisk().map(cursorName));
  let removed = 0;
  for (const file of files) {
    if (!file.endsWith('.offset') || live.has(file)) continue;
    rmSync(join(dir, file), { force: true });
    removed += 1;
  }
  return removed;
}
