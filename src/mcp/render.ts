import type { Observation, ObservationIndexEntry } from '../types.js';
import { toShortId } from '../util/shortid.js';
import { clipBody } from '../util/snippet.js';

/**
 * How the three layers are shown to the agent.
 *
 * Split out of the server so it can be exercised without opening a stdio
 * transport: this is the format every search result is paid in, and it had no
 * test of any kind while the server module could only be imported by starting
 * a server.
 */

/**
 * Layer 1. Every character here is multiplied by the number of results and
 * paid on every search, so the format stays terse: short id, kind, month-day,
 * title, and one indented line of the body around the match.
 *
 * The snippet is the half that was missing. Terseness only pays if the row can
 * be chosen from what is shown, and a title often cannot carry that — fifteen
 * results dated the same day, titled things like "Committed as 30daa92", leave
 * a reader nothing to pick on, so they expand two at random and pay a full body
 * for each guess. Sixty characters here saves several thousand there.
 */
export function renderIndex(entries: ObservationIndexEntry[]): string {
  if (entries.length === 0) return 'No matching observations.';

  const rows = entries.map((entry) => {
    const date = new Date(entry.createdAt).toISOString().slice(5, 10);
    const head = `${toShortId(entry.id)} ${entry.kind} ${date} ${entry.title}`;
    // Absent for a row only vector search found: it holds no query terms to
    // centre a fragment on.
    return entry.snippet ? `${head}\n    ${entry.snippet}` : head;
  });
  return `${entries.length} result(s):\n${rows.join('\n')}`;
}

/** Layer 3. Full detail for one observation, bounded by `chars`. */
export function renderFull(obs: Observation, chars: number): string {
  return [
    `id: ${toShortId(obs.id)}`,
    `kind: ${obs.kind}`,
    `when: ${new Date(obs.createdAt).toISOString()}`,
    obs.author ? `who: ${obs.author}` : null,
    obs.files.length > 0 ? `files: ${obs.files.join(', ')}` : null,
    '',
    obs.title,
    '',
    clipBody(obs.body, chars),
  ]
    .filter((line) => line !== null)
    .join('\n');
}
