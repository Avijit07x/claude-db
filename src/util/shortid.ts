/**
 * Display form for observation ids.
 *
 * A full UUID costs about 9 tokens per line, roughly as much as the title it
 * labels, so nearly half of a search result is identifier noise. Taking the
 * first two UUID groups keeps 12 hex digits of entropy (2.8e14 values), which
 * makes a collision vanishingly unlikely at the scale one database holds, and
 * cuts the identifier to about 4 tokens.
 *
 * The short form is a literal prefix of the stored id, so resolution is a
 * prefix match that every backend can serve from its primary key index. Same
 * idea as an abbreviated git SHA.
 */
const SHORT_LENGTH = 13; // "2904a5fd-0f22"

export function toShortId(id: string): string {
  return id.slice(0, SHORT_LENGTH);
}

/** True when a caller passed a short form rather than a full uuid. */
export function isShortId(id: string): boolean {
  return id.length < 36;
}

/**
 * Split incoming ids into exact matches and prefixes so adapters can issue one
 * indexed `IN (...)` query plus one prefix query, rather than a scan per id.
 */
export function partitionIds(ids: string[]): { exact: string[]; prefixes: string[] } {
  const exact: string[] = [];
  const prefixes: string[] = [];
  for (const id of ids) {
    if (isShortId(id)) prefixes.push(id);
    else exact.push(id);
  }
  return { exact, prefixes };
}
