import type { CodeSymbol } from '../../../types.js';
import type { AstNode } from '../../parser.js';
import type { Receiver, Reference } from '../../types.js';
import type { ImportFacts } from '../binding.js';
import { typeRef } from './types.js';

export const SELF: Receiver = { kind: 'self' };
export const PARENT: Receiver = { kind: 'parent' };
export const OUTSIDE: Receiver = { kind: 'outside' };
export const UNKNOWN: Receiver = { kind: 'unknown' };
export const TYPE_NAME = /^[A-Z](?![A-Z0-9_]*$)/;

export interface ReceiverInput {
  nodes: ReadonlyMap<string, AstNode[]>;
  facts: ImportFacts;
  own: string;
  symbols: CodeSymbol[];
}

export interface Scoped {
  name: string;
  from: number;
  to: number;
  at: number;
  field: boolean;
}

export type FindDeclared<T> = (
  name: string,
  position: number,
  fieldsOnly?: boolean,
) => T | undefined;

export function scopeLookup<T extends Scoped>(entries: Iterable<T>): FindDeclared<T> {
  const byName = new Map<string, T[]>();
  for (const entry of entries) {
    const known = byName.get(entry.name);
    if (known) known.push(entry);
    else byName.set(entry.name, [entry]);
  }

  return (name, position, fieldsOnly = false) => {
    let best: T | undefined;
    for (const entry of byName.get(name) ?? []) {
      if (fieldsOnly && !entry.field) continue;
      if (position < entry.from || position >= entry.to || position < entry.at) continue;
      const width = entry.to - entry.from;
      const narrower = !best || width < best.to - best.from;
      const later = best !== undefined && width === best.to - best.from && entry.at > best.at;
      if (narrower || later) best = entry;
    }
    return best;
  };
}

export function memoize<K, V>(compute: (key: K) => V): (key: K) => V {
  const known = new Map<K, V>();
  return (key) => {
    if (known.has(key)) return known.get(key) as V;
    const value = compute(key);
    known.set(key, value);
    return value;
  };
}

export function typeParameterNames(nodes: ReadonlyMap<string, AstNode[]>): Set<string> {
  const names = (nodes.get('type_parameter') ?? []).map((parameter) =>
    parameter.children().find((child) => child.kind() === 'type_identifier'),
  );
  return new Set(names.flatMap((name) => (name ? [name.text()] : [])));
}

export interface PathContext {
  own: string;
  facts: ImportFacts;
  generics: ReadonlySet<string>;
  exact: boolean;
}

export function pathReceivers(context: PathContext): (path: string[]) => Receiver | null {
  const { own, facts, generics, exact } = context;
  const byKey = memoize((key: string): Receiver | null => {
    const path = key.split('.');
    const [head] = path;
    if (!head || (path.length === 1 && generics.has(head))) return null;
    const type = typeRef(path, own, facts);
    if (!type) return null;
    return exact ? { kind: 'type', type, exact: true } : { kind: 'type', type };
  });
  return (path) => byKey(path.join('.'));
}

export const resultOf = (of: string, exact: boolean): Receiver =>
  exact ? { kind: 'result', of, exact: true } : { kind: 'result', of };

export function symbolAt(symbols: CodeSymbol[]): (name: AstNode) => string | undefined {
  const ids = new Map(symbols.map((symbol) => [`${symbol.name}:${symbol.line}`, symbol.id]));
  return (name) => ids.get(`${name.text()}:${name.range().start.line + 1}`);
}

export interface Typing {
  receiverOf: (object: AstNode | null, position: number) => Receiver;
  attach: (references: Reference[]) => Reference[];
}

export interface Typed {
  calls?: ReadonlyMap<string, Receiver>;
  returns: ReadonlyMap<string, Receiver>;
}

export function attachReceivers(references: Reference[], typed: Typed): Reference[] {
  return references.map((reference) => {
    const receiver =
      reference.relation === 'calls' && reference.origin !== undefined
        ? typed.calls?.get(reference.origin)
        : undefined;
    if (receiver) return { ...reference, receiver };
    const returned =
      reference.relation === 'defines' && reference.to
        ? typed.returns.get(reference.to)
        : undefined;
    return returned ? { ...reference, returns: returned } : reference;
  });
}
