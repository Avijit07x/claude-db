import type { Observation, ObservationIndexEntry } from '../types.js';
import { toShortId } from '../util/shortid.js';
import { clipBody } from '../util/snippet.js';

export function renderIndex(entries: ObservationIndexEntry[]): string {
  if (entries.length === 0) return 'No matching observations.';

  const rows = entries.map((entry) => {
    const date = new Date(entry.createdAt).toISOString().slice(5, 10);
    const head = `${toShortId(entry.id)} ${entry.kind} ${date} ${entry.title}`;
    const worth = entry.snippet !== undefined && !echoesTitle(entry.snippet, entry.title);
    return worth ? `${head}\n    ${entry.snippet}` : head;
  });
  return `${entries.length} result(s):\n${rows.join('\n')}`;
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function echoesTitle(snippet: string, title: string): boolean {
  const tokens = words(snippet);
  if (tokens.length === 0) return true;
  const inTitle = new Set(words(title));
  const shared = tokens.filter((word) => inTitle.has(word)).length;
  return shared / tokens.length >= 0.7;
}

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
