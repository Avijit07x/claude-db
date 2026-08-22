import type { Observation, ObservationIndexEntry } from '../types.js';
import { meaningfulTokens } from '../search/stopwords.js';
import { toShortId } from '../util/shortid.js';

export function overlapCount(
  prompt: string,
  entry: { title: string; snippet?: string | undefined },
): number {
  const wanted = new Set(meaningfulTokens(prompt.toLowerCase()));
  const offered = new Set(meaningfulTokens(`${entry.title} ${entry.snippet ?? ''}`.toLowerCase()));
  let shared = 0;
  for (const word of wanted) if (offered.has(word)) shared++;
  return shared;
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
    const head = `${toShortId(entry.id)} ${entry.kind} ${date} ${entry.title}`;
    const line = entry.snippet ? `${head}\n    ${entry.snippet}` : head;
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
