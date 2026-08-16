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
    // centre a fragment on. Dropped too when it only restates the title.
    const worth = entry.snippet !== undefined && !echoesTitle(entry.snippet, entry.title);
    return worth ? `${head}\n    ${entry.snippet}` : head;
  });
  return `${entries.length} result(s):\n${rows.join('\n')}`;
}

/** Lowercased alphanumeric runs — the only form the two sides share. */
function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/**
 * True when a fragment says little the title has not already said.
 *
 * A search engine centres its window on the query match, and the title is taken
 * from the body, so on a short observation the two are frequently the same
 * sentence — the row then pays a second time for a line already shown. Observed
 * live: a title of "Added as section 3 of PLAN.md, with the later sections
 * renumbered" under a fragment reading "…Added as section 3 of [PLAN.md](PLAN.md),
 * with the later…".
 *
 * Compared as a bag of words rather than by substring, because that example is
 * exactly the case a substring test misses: the fragment comes from the raw body
 * and still carries the markdown the title had stripped.
 */
function echoesTitle(snippet: string, title: string): boolean {
  const tokens = words(snippet);
  if (tokens.length === 0) return true;
  const inTitle = new Set(words(title));
  const shared = tokens.filter((word) => inTitle.has(word)).length;
  // Not 1.0: the window carries the ellipses and a spill word or two from the
  // neighbouring sentence, so an exact echo never scores as one.
  return shared / tokens.length >= 0.7;
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
