import type { EdgeRelation } from '../../types.js';
import type { Reference } from '../types.js';
import type { ImportFacts, Imported, Lines, Target, Unbound } from './binding.js';
import { segmentsOf } from './names.js';
import type { Shadows } from './shadowing.js';

const REBOUND = new Set<EdgeRelation>(['calls', 'references', 'extends', 'implements', 'aliases']);

const width = (lines: Lines): number => lines.end - lines.start;

export function visible<T extends { within?: Lines }>(
  entries: readonly T[] | undefined,
  lineOf: () => number,
): T | undefined {
  let best: T | undefined;
  for (const entry of entries ?? []) {
    const { within } = entry;
    if (within) {
      const line = lineOf();
      if (line < within.start || line > within.end) continue;
    }
    const tighter = !best?.within || (within !== undefined && width(within) <= width(best.within));
    if (!best || tighter) best = entry;
  }
  return best;
}

export function targetOf(imported: Imported, written: string): Target {
  const renamed = imported.name !== written;
  return {
    name: imported.name,
    link: renamed ? { ...imported.link, strict: true } : imported.link,
  };
}

export function rebind(
  reference: Reference,
  facts: ImportFacts,
  shadows: Shadows,
  unbound: Unbound | undefined,
): Reference {
  if (reference.link !== undefined || !REBOUND.has(reference.relation)) return reference;

  const line = (): number => reference.line;
  const bound = <T extends { within?: Lines }>(entries: T[] | undefined, name: string) =>
    shadows.at(name, reference.line) ? undefined : visible(entries, line);

  const imported = bound(facts.named.get(reference.name), reference.name);
  if (imported) return { ...reference, ...targetOf(imported, reference.name) };

  const free = (): Reference => {
    const target = unbound?.reference(reference, facts);
    return target ? { ...reference, ...target } : reference;
  };

  const path = segmentsOf(reference.name);
  if (path.length < 2) return free();
  const head = path[0] ?? '';
  const via = path.slice(1, -1);

  const space = bound(facts.spaces.get(head), head);
  if (space) return { ...reference, link: { specifier: space.specifier, via } };

  const first = bound(facts.named.get(head), head);
  if (first) {
    return { ...reference, link: { specifier: first.link.specifier, via: [first.name, ...via] } };
  }
  return free();
}
