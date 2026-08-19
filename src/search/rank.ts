import type { ObservationIndexEntry } from '../types.js';

const RRF_K = 60;

export function fuse(rankings: ObservationIndexEntry[][], limit: number): ObservationIndexEntry[] {
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
      return { ...entry, score: entry.score * (0.7 + 0.3 * decay) };
    })
    .sort((a, b) => b.score - a.score);
}
