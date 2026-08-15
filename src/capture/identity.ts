import { createHash } from 'node:crypto';

/**
 * Derives a stable id for an observation from its content.
 *
 * Random ids make every write path non-idempotent: re-running SessionEnd, or
 * flushing a session twice, produces a second copy of the same memory under a
 * different primary key, so `INSERT OR REPLACE` cannot collapse them. Search
 * then returns near-identical pairs and the reader loses trust in the results.
 *
 * Hashing the session, the turn's timestamp and its prompt means the same turn
 * always lands on the same row. Reprocessing becomes a no-op, which is exactly
 * what allows memory to be flushed continuously rather than once at the end.
 */
export function observationId(sessionId: string, timestamp: number, seed: string): string {
  const digest = createHash('sha256')
    .update(`${sessionId} ${timestamp} ${seed}`)
    .digest('hex');

  // Shaped like a UUID so the short-id prefix rules keep working unchanged.
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join('-');
}
