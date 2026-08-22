import type { MemoryStore } from '../../store/adapter.js';

const CANDIDATES = 5000;

function tokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase())
    .map((part) => (part.length > 3 && part.endsWith('s') ? part.slice(0, -1) : part));
}

function score(candidate: string, query: string): number {
  const left = candidate.toLowerCase();
  const right = query.toLowerCase();
  if (left === right) return 100;

  const longest = Math.max(left.length, right.length);

  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) {
    prefix += 1;
  }
  const byPrefix = prefix >= 3 ? (prefix / longest) * 120 : 0;

  const wanted = tokens(query);
  const mine = tokens(candidate);
  const shared = mine.filter((part) => wanted.includes(part)).length;
  const byToken = shared > 0 ? (shared / Math.max(mine.length, wanted.length)) * 100 : 0;

  const contains = left.includes(right) || right.includes(left);
  const byContains = contains ? (Math.min(left.length, right.length) / longest) * 100 : 0;

  return Math.max(byPrefix, byToken, byContains);
}

export function nearest(names: Iterable<string>, symbol: string, limit = 5): string[] {
  const scored = new Map<string, number>();
  for (const name of names) {
    if (name === symbol || name.length < 3) continue;
    const value = score(name, symbol);
    if (value >= 40) scored.set(name, Math.max(scored.get(name) ?? 0, value));
  }

  return [...scored]
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name);
}

export async function suggestFor(
  store: MemoryStore,
  project: string,
  symbol: string,
): Promise<string[]> {
  if (!symbol) return [];
  try {
    const symbols = await store.findSymbols({ project, limit: CANDIDATES });
    return nearest(
      symbols.map((entry) => entry.name),
      symbol,
    );
  } catch {
    return [];
  }
}

export function formatSuggestions(suggestions: string[]): string {
  if (suggestions.length === 0) return '';
  return `\nDid you mean: ${suggestions.join(', ')}`;
}
