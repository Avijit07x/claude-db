import type { Observation, ObservationIndexEntry } from '../types.js';
import { toShortId } from '../util/shortid.js';

/**
 * Prompts that carry no retrievable intent. Searching memory for "ok" or
 * "continue" wastes a query and, worse, risks injecting unrelated context that
 * teaches the reader to ignore the memory block entirely.
 */
const TRIVIAL = new Set([
  'ok', 'okay', 'yes', 'no', 'yep', 'nope', 'sure', 'thanks', 'thank you',
  'continue', 'go on', 'go ahead', 'next', 'stop', 'wait', 'done', 'good',
  'nice', 'perfect', 'great', 'do it', 'proceed', 'retry', 'again', 'fix it',
]);

/** Tokens that appear in almost every prompt and cannot discriminate. */
const NOISE = new Set([
  'the', 'and', 'for', 'this', 'that', 'with', 'you', 'can', 'please', 'now',
  'what', 'why', 'how', 'when', 'where', 'are', 'was', 'were', 'have', 'has',
  'not', '但', 'let', 'make', 'get', 'add', 'use', 'need', 'want', 'should',
]);

/**
 * Decides whether a prompt is worth a memory lookup at all.
 *
 * This runs before the query, so a cheap reject here saves the entire search.
 * The bar is deliberately low: two content words. The goal is to skip
 * conversational filler, not to predict relevance, which is what search is for.
 */
export function isSearchable(prompt: string): boolean {
  const normalized = prompt.trim().toLowerCase();
  if (normalized.length < 8) return false;
  if (TRIVIAL.has(normalized.replace(/[.!?]+$/, ''))) return false;

  const content = normalized
    .split(/[^a-z0-9_]+/i)
    .filter((word) => word.length > 2 && !NOISE.has(word));

  return content.length >= 2;
}

/**
 * Renders the block injected above a user prompt.
 *
 * Titles only, no bodies. The point is to tell Claude that relevant history
 * exists and give it the ids to expand, not to pre-load the history itself.
 * Pre-loading bodies is what makes naive memory tools expensive.
 *
 * Returns null when there is nothing worth saying, so the caller emits
 * nothing at all rather than an empty container.
 */
export function renderPromptContext(
  entries: ObservationIndexEntry[],
  maxChars: number,
  expanded: Observation[] = [],
  expandMaxChars = 900,
): string | null {
  if (entries.length === 0) return null;

  const expandedIds = new Set(expanded.map((obs) => obs.id));
  const sections: string[] = [];

  // Best match in full. This is the part that answers the question outright
  // instead of telling the agent where it could look.
  for (const obs of expanded) {
    const date = new Date(obs.createdAt).toISOString().slice(0, 10);
    sections.push(
      `${toShortId(obs.id)} ${obs.kind} ${date} ${obs.title}\n` +
        clip(obs.body, expandMaxChars),
    );
  }

  // Remaining matches stay as pointers, cheap enough to be worth listing.
  const lines: string[] = [];
  let budget = maxChars;
  for (const entry of entries) {
    if (expandedIds.has(entry.id)) continue;
    const date = new Date(entry.createdAt).toISOString().slice(0, 7);
    const line = `${toShortId(entry.id)} ${entry.kind} ${date} ${entry.title}`;
    if (line.length > budget) break;
    budget -= line.length + 1;
    lines.push(line);
  }

  if (sections.length === 0 && lines.length === 0) return null;

  return [
    '<recalled-memory>',
    ...sections,
    ...(lines.length > 0 ? [lines.join('\n')] : []),
    '</recalled-memory>',
    'Prior work on this project. Expand any listed id with get_observations ' +
      'before asking the user to re-explain.',
  ].join('\n');
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n... [truncated]`;
}
