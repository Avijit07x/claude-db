import type { CodeEdge, CodeSymbol } from '../../types.js';
import { moduleIndex } from '../modules/module-index.js';
import type { ModuleIndex } from '../modules/module-index.js';
import { lastSegment } from '../modules/names.js';
import type { ModuleContext } from '../modules/system.js';
import type { Reference, TypeRef } from '../types.js';
import { OUTSIDE, createReceivers } from './receivers.js';
import type { Value } from './receivers.js';

const SAME_FILE = 1;
const SINGLE_MATCH = 0.95;
const AMBIGUOUS_MATCH = 0.85;
const INHERITANCE_DEPTH = 6;
const OWNERS = new Set(['class', 'interface', 'enum']);
const MEMBERS = new Set(['method', 'function', 'class', 'interface', 'enum']);
const HERITAGE = new Set(['extends', 'implements']);
const CALLABLE = new Set(['method', 'function']);
const OUTSIDE_CALL: Resolution = {
  target: undefined,
  confidence: 'EXTRACTED',
  score: SAME_FILE,
  external: true,
};

export interface Resolution {
  target: CodeSymbol | undefined;
  confidence: CodeEdge['confidence'];
  score: number;
  external: boolean;
}

export interface Binder {
  resolve: (reference: Reference) => Resolution | null;
}

function enterNamespaces(
  index: ModuleIndex,
  file: string | null,
  path: string[] = [],
): string | undefined {
  let current = file ?? undefined;
  for (const segment of path) current = current ? index.enter(current, segment) : undefined;
  return current;
}

function group<T>(items: Iterable<T>, keyOf: (item: T) => string | undefined): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (key === undefined) continue;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(item);
    else grouped.set(key, [item]);
  }
  return grouped;
}

export function createBinder(
  symbols: CodeSymbol[],
  references: Reference[],
  context: ModuleContext,
): Binder {
  const index = moduleIndex(symbols, references, context);
  const byName = group(symbols, (symbol) => symbol.name);
  const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]));

  const members = new Map<string, Map<string, CodeSymbol[]>>();
  for (const reference of references) {
    const member = reference.to ? byId.get(reference.to) : undefined;
    if (reference.relation !== 'defines' || !reference.from || !member) continue;
    if (!MEMBERS.has(member.kind)) continue;
    const owned = members.get(reference.from.id) ?? new Map<string, CodeSymbol[]>();
    members.set(reference.from.id, owned);
    const named = owned.get(member.name);
    if (named) named.push(member);
    else owned.set(member.name, [member]);
  }
  const parents = new Map<string, CodeSymbol[]>();
  const cache = new Map<Reference, Resolution | null>();
  const types = new Map<string, Value>();
  const typesByRef = new WeakMap<TypeRef, Value>();

  const opened = (reference: Reference, wanted: string): CodeSymbol | undefined => {
    for (const specifier of reference.link?.opens ?? []) {
      const file = index.fileOf(reference.file, specifier);
      const found = file ? index.find(file, wanted) : undefined;
      if (found) return found;
    }
    return undefined;
  };

  const inherited = (
    owner: CodeSymbol,
    wanted: string,
    seen = new Set<string>(),
  ): CodeSymbol | undefined => {
    if (seen.has(owner.id) || seen.size > INHERITANCE_DEPTH) return undefined;
    seen.add(owner.id);
    const named = members.get(owner.id)?.get(wanted);
    if (named) return named.find((symbol) => symbol.kind === 'method') ?? named[0];
    for (const parent of parents.get(owner.id) ?? []) {
      const found = inherited(parent, wanted, seen);
      if (found) return found;
    }
    return undefined;
  };

  const memberOf = (
    reference: Reference,
    source: string | null,
    wanted: string,
  ): CodeSymbol | undefined => {
    const via = reference.link?.via;
    const owner = source && via?.length === 1 ? index.find(source, via[0] ?? '') : undefined;
    return owner && OWNERS.has(owner.kind) ? inherited(owner, wanted) : undefined;
  };

  const declaredHere = (reference: Reference, wanted: string): CodeSymbol | undefined =>
    (byName.get(wanted) ?? []).find(
      (symbol) => symbol.file === reference.file && symbol.kind !== 'method',
    );

  const lookupType = (file: string, type: TypeRef): Value => {
    const link = type.link ? { link: type.link } : {};
    const resolution = compute({
      file,
      name: type.name,
      relation: 'references',
      line: 0,
      from: null,
      ...link,
    });
    if (resolution?.external) return OUTSIDE;
    const target = resolution?.confidence === 'EXTRACTED' ? resolution.target : undefined;
    if (target && OWNERS.has(target.kind)) return { symbol: target };
    const named = byName.get(lastSegment(type.name)) ?? [];
    return named.some((symbol) => OWNERS.has(symbol.kind)) ? null : OUTSIDE;
  };

  const typeOf = (file: string, type: TypeRef): Value => {
    const known = typesByRef.get(type);
    if (known !== undefined) return known;
    const value = typeByKey(file, type);
    typesByRef.set(type, value);
    return value;
  };

  const typeByKey = (file: string, type: TypeRef): Value => {
    const key = `${file}\0${type.name}\0${type.link?.specifier ?? ''}\0${type.link?.via?.join('.') ?? ''}`;
    if (!types.has(key)) types.set(key, lookupType(file, type));
    return types.get(key) ?? null;
  };

  const callee = (call: Reference): CodeSymbol | undefined => {
    const resolution = resolve(call);
    const target = resolution?.confidence === 'EXTRACTED' ? resolution.target : undefined;
    return target && CALLABLE.has(target.kind) ? target : undefined;
  };

  const receivers = createReceivers(references, {
    inherited: (owner, wanted) => inherited(owner, wanted),
    parentsOf: (owner) => parents.get(owner.id) ?? [],
    typeOf,
    callee,
  });

  const throughReceiver = (reference: Reference): Resolution | null | undefined => {
    if (reference.relation !== 'calls' || !reference.receiver) return undefined;
    const member = receivers.memberFor(reference, lastSegment(reference.name));
    if (!member) return undefined;
    if ('outside' in member) return OUTSIDE_CALL;
    return { target: member.target, confidence: 'EXTRACTED', score: SAME_FILE, external: false };
  };

  const compute = (reference: Reference): Resolution | null => {
    const typed = throughReceiver(reference);
    if (typed !== undefined) return typed;
    const link = reference.link;
    const source = link ? index.fileOf(reference.file, link.specifier) : null;
    const here = (symbol: CodeSymbol): boolean =>
      context.unit(symbol.file) === context.unit(reference.file);
    const external =
      !!link &&
      !source &&
      (reference.relation === 'imports'
        ? context.isExternal(reference.file, link.specifier)
        : context.isForeign(reference.file, link.specifier));

    const lookedUp = link ? lastSegment(reference.name) : reference.name;
    const wanted = link?.member ?? lookedUp;
    const home = enterNamespaces(index, source, link?.via);
    const direct = home ? index.find(home, wanted) : undefined;
    const found =
      direct ??
      opened(reference, wanted) ??
      (home === undefined ? memberOf(reference, source, wanted) : undefined);
    const inOwnUnit = source !== null && source === context.unit(reference.file);
    const bound = inOwnUnit && !link?.via ? (declaredHere(reference, wanted) ?? found) : found;
    const isModule = !bound && home !== undefined && index.enter(home, wanted) !== undefined;

    const named = byName.get(lookedUp) ?? [];
    const candidates =
      external || isModule ? [] : link ? named.filter((symbol) => !here(symbol)) : named;
    const exact = reference.to
      ? candidates.find((candidate) => candidate.id === reference.to)
      : undefined;
    const local =
      exact ??
      bound ??
      candidates.find((symbol) => symbol.file === reference.file) ??
      candidates.find(here);
    if (link?.strict && !bound) return null;
    const target = local ?? candidates[0];
    if (!target && reference.weak) return null;

    const guessed = !exact && !bound && reference.receiver?.kind === 'unknown';
    if (local && !guessed) return { target, confidence: 'EXTRACTED', score: SAME_FILE, external };
    if (candidates.length === 1) {
      return { target, confidence: 'INFERRED', score: SINGLE_MATCH, external };
    }
    const ambiguous = candidates.length > 1;
    return {
      target,
      confidence: ambiguous ? 'INFERRED' : 'EXTRACTED',
      score: ambiguous ? AMBIGUOUS_MATCH : SAME_FILE,
      external,
    };
  };

  const resolve = (reference: Reference): Resolution | null => {
    if (cache.has(reference)) return cache.get(reference) ?? null;
    cache.set(reference, null);
    const resolution = compute(reference);
    cache.set(reference, resolution);
    return resolution;
  };

  for (const reference of references) {
    const child = reference.from;
    if (!HERITAGE.has(reference.relation) || !child) continue;
    const parent = resolve(reference)?.target;
    if (parent) parents.set(child.id, [...(parents.get(child.id) ?? []), parent]);
  }

  return { resolve };
}
