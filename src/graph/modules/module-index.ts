import type { CodeSymbol } from '../../types.js';
import type { Reference } from '../types.js';
import type { ModuleContext } from './system.js';

const REEXPORT_DEPTH = 6;
const EVERYTHING = '*';

export interface ModuleIndex {
  fileOf(from: string, specifier: string): string | null;
  find(file: string, name: string): CodeSymbol | undefined;
  enter(file: string, segment: string): string | undefined;
}

const keyOf = (file: string, name: string): string => `${file}\0${name}`;

function pick(symbols: CodeSymbol[] | undefined): CodeSymbol | undefined {
  return symbols?.find((symbol) => symbol.kind !== 'method') ?? symbols?.[0];
}

export function moduleIndex(
  symbols: CodeSymbol[],
  references: Reference[],
  context: ModuleContext,
): ModuleIndex {
  const declared = new Map<string, CodeSymbol[]>();
  for (const symbol of symbols) {
    const key = keyOf(context.unit(symbol.file), symbol.name);
    declared.set(key, [...(declared.get(key) ?? []), symbol]);
  }

  const links = new Map<string, Reference[]>();
  const spaces = new Map<string, Reference>();
  for (const reference of references) {
    const link = reference.link;
    if (link?.exported === undefined) continue;
    if (link.namespace) spaces.set(keyOf(reference.file, link.exported), reference);
    else links.set(reference.file, [...(links.get(reference.file) ?? []), reference]);
  }

  const resolved = new Map<string, Map<string, string | null>>();
  const fileOf = (from: string, specifier: string): string | null => {
    const known = resolved.get(from) ?? new Map<string, string | null>();
    resolved.set(from, known);
    const file = known.get(specifier);
    if (file !== undefined) return file;
    const found = context.resolve(from, specifier);
    known.set(specifier, found);
    return found;
  };

  const walk = <T>(
    file: string,
    name: string,
    own: (file: string, name: string) => T | undefined,
    depth = 0,
    seen = new Set<string>(),
  ): T | undefined => {
    const here = own(file, name);
    if (here !== undefined || depth >= REEXPORT_DEPTH || seen.has(file)) return here;
    seen.add(file);

    for (const reference of links.get(file) ?? []) {
      const link = reference.link;
      if (!link || (link.exported !== EVERYTHING && link.exported !== name)) continue;
      const target = fileOf(file, link.specifier);
      const wanted = link.exported === EVERYTHING ? name : reference.name;
      const found = target ? walk(target, wanted, own, depth + 1, seen) : undefined;
      if (found !== undefined) return found;
    }
    return undefined;
  };

  const declaredIn = (file: string, name: string): CodeSymbol | undefined =>
    pick(declared.get(keyOf(file, name)));
  const spaceIn = (file: string, name: string): string | undefined => {
    const space = spaces.get(keyOf(file, name));
    return space?.link ? (fileOf(file, space.link.specifier) ?? undefined) : undefined;
  };

  return {
    fileOf,
    find: (file, name) => walk(file, name, declaredIn),
    enter: (file, segment) =>
      walk(file, segment, spaceIn) ?? context.child(file, segment) ?? undefined,
  };
}
