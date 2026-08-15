import type { ObservationIndexEntry } from '../types.js';

/** Damping constant from the original RRF paper. */
const RRF_K = 60;

/**
 * Reciprocal Rank Fusion.
 *
 * Keyword scores (BM25, ts_rank) and vector scores (cosine) live on
 * incompatible scales, so normalizing them against each other is guesswork.
 * RRF sidesteps that by discarding magnitudes and fusing on rank position
 * alone: an item ranked 1st by either retriever scores 1/(k+1) from it.
 * That makes the blend robust with no per-backend tuning.
 */
export function fuse(
  rankings: ObservationIndexEntry[][],
  limit: number,
): ObservationIndexEntry[] {
  const scores = new Map<string, number>();
  const entries = new Map<string, ObservationIndexEntry>();

  for (const ranking of rankings) {
    ranking.forEach((entry, index) => {
      const contribution = 1 / (RRF_K + index + 1);
      scores.set(entry.id, (scores.get(entry.id) ?? 0) + contribution);
      if (!entries.has(entry.id)) entries.set(entry.id, entry);
    });
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, score]) => ({ ...(entries.get(id) as ObservationIndexEntry), score }));
}

/**
 * Mild recency preference applied after fusion. Memory about a codebase decays
 * in usefulness: a decision from last week usually beats one from last year.
 * Half-life is deliberately long so old-but-relevant results still surface.
 */
export function applyRecencyBoost(
  entries: ObservationIndexEntry[],
  now: number,
  halfLifeDays = 45,
): ObservationIndexEntry[] {
  const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;
  return entries
    .map((entry) => {
      const age = Math.max(0, now - entry.createdAt);
      const decay = Math.pow(0.5, age / halfLifeMs);
      // Floor at 0.7 so recency nudges ordering without overpowering relevance.
      return { ...entry, score: entry.score * (0.7 + 0.3 * decay) };
    })
    .sort((a, b) => b.score - a.score);
}
