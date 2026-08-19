import type { Observation, ObservationIndexEntry } from '../types.js';
import { toShortId } from '../util/shortid.js';

const TRIVIAL = new Set([
  'ok',
  'okay',
  'yes',
  'no',
  'yep',
  'nope',
  'sure',
  'thanks',
  'thank you',
  'continue',
  'go on',
  'go ahead',
  'next',
  'stop',
  'wait',
  'done',
  'good',
  'nice',
  'perfect',
  'great',
  'do it',
  'proceed',
  'retry',
  'again',
  'fix it',
]);

const NOISE = new Set([
  'the',
  'and',
  'for',
  'this',
  'that',
  'with',
  'you',
  'can',
  'please',
  'now',
  'what',
  'why',
  'how',
  'when',
  'where',
  'are',
  'was',
  'were',
  'have',
  'has',
  'not',
  'let',
  'make',
  'get',
  'add',
  'use',
  'need',
  'want',
  'should',
]);

const DENSE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

export function isSearchable(prompt: string): boolean {
  const normalized = prompt.trim().toLowerCase();
  if (TRIVIAL.has(normalized.replace(/[.!?]+$/, ''))) return false;

  if ((normalized.match(DENSE_SCRIPT)?.length ?? 0) >= 4) return true;
  if (normalized.length < 8) return false;

  const content = normalized
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((word) => word.length > 2 && !NOISE.has(word));

  return content.length >= 2;
}

export function renderPromptContext(
  entries: ObservationIndexEntry[],
  maxChars: number,
  expanded: Observation[] = [],
  expandMaxChars = 900,
): string | null {
  if (entries.length === 0) return null;

  const expandedIds = new Set(expanded.map((obs) => obs.id));
  const sections: string[] = [];

  for (const obs of expanded) {
    const date = new Date(obs.createdAt).toISOString().slice(0, 10);
    sections.push(
      `${toShortId(obs.id)} ${obs.kind} ${date} ${obs.title}\n` + clip(obs.body, expandMaxChars),
    );
  }

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
