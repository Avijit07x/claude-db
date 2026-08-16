/**
 * Shaping for the two places a body is shown in part rather than in full.
 *
 * Layer 1 was built on the assumption that a title tells you which row holds
 * the answer. It often does not — "Committed as 30daa92" is a true report of an
 * outcome and says nothing about whether to expand it — so a search returned
 * fifteen rows that all looked alike and the only way to choose was to guess.
 * A snippet costs about sixty characters and saves a whole body per wrong
 * guess, which is the trade the terse index was making in the wrong direction.
 */

const SNIPPET_MAX = 110;

/**
 * One line, whitespace collapsed, clipped at a word boundary.
 *
 * Bodies carry newlines, markdown tables and code, none of which survive being
 * shown on one line of an index; and the search engines wrap matches in their
 * own markers, which are noise once the fragment is already the point.
 */
export function toSnippet(text: unknown, max = SNIPPET_MAX): string | undefined {
  if (typeof text !== 'string') return undefined;

  // Backticks, pipes and asterisks are markup and only ever noise on one line.
  // Underscores and hashes are left alone: they are far more often part of an
  // identifier than of emphasis, and stripping them turned
  // `aggregation_cursor.js` into two words that match nothing.
  const flat = text
    .replace(/<\/?b>/g, '')
    .replace(/[|`*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length === 0) return undefined;
  if (flat.length <= max) return flat;

  const cut = flat.slice(0, max);
  const word = cut.lastIndexOf(' ');
  return `${cut.slice(0, word > max * 0.6 ? word : max)}…`;
}

/**
 * Bounds a full body at layer 3.
 *
 * The cost argument that made the index terse was never applied one layer down,
 * where a single call may ask for twenty-five bodies at once — so the multiplier
 * is far worse there than in the index it was written for. The remainder is
 * counted rather than dropped silently, because a reader who needs the rest has
 * to know it exists.
 */
export function clipBody(body: string, max: number): string {
  if (body.length <= max) return body;
  return `${body.slice(0, max)}\n… ${body.length - max} more characters (raise \`chars\` to read them)`;
}
