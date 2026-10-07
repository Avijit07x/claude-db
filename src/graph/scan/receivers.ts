import type { CodeSymbol } from '../../types.js';
import type { Receiver, Reference, TypeRef } from '../types.js';

const OWNERS = new Set(['class', 'interface', 'enum']);
const NESTING_DEPTH = 8;

export const OUTSIDE = { outside: true } as const;

export type Value = { symbol: CodeSymbol } | typeof OUTSIDE | null;
export type Member = { target: CodeSymbol } | typeof OUTSIDE | null;

export interface Hierarchy {
  inherited: (owner: CodeSymbol, wanted: string) => CodeSymbol | undefined;
  parentsOf: (owner: CodeSymbol) => CodeSymbol[];
  typeOf: (file: string, type: TypeRef) => Value;
  callee: (call: Reference) => CodeSymbol | undefined;
}

export interface Receivers {
  memberFor: (reference: Reference, wanted: string) => Member;
}

const isBetterCall = (candidate: Reference, known: Reference | undefined): boolean =>
  !known || (!known.link && !known.receiver && !!(candidate.link ?? candidate.receiver));

function firstMember(
  owners: CodeSymbol[],
  find: (owner: CodeSymbol) => CodeSymbol | undefined,
): Member {
  for (const owner of owners) {
    const found = find(owner);
    if (found) return { target: found };
  }
  return null;
}

export function createReceivers(references: Reference[], hierarchy: Hierarchy): Receivers {
  const ownerOf = new Map<string, CodeSymbol>();
  const returnsOf = new Map<string, Reference>();
  const calls = new Map<string, Map<string, Reference>>();
  const around = new Map<string, CodeSymbol[]>();

  for (const reference of references) {
    if (reference.relation === 'defines' && reference.from && reference.to) {
      ownerOf.set(reference.to, reference.from);
      if (reference.returns) returnsOf.set(reference.to, reference);
    }
    if (reference.relation !== 'calls' || reference.origin === undefined) continue;
    const inFile = calls.get(reference.file) ?? new Map<string, Reference>();
    calls.set(reference.file, inFile);
    if (isBetterCall(reference, inFile.get(reference.origin))) {
      inFile.set(reference.origin, reference);
    }
  }

  const walkOut = (symbol: CodeSymbol): CodeSymbol[] => {
    const classes: CodeSymbol[] = [];
    let at: CodeSymbol | undefined = symbol;
    for (let depth = 0; at && depth < NESTING_DEPTH; depth += 1) {
      if (OWNERS.has(at.kind)) classes.push(at);
      at = ownerOf.get(at.id);
    }
    return classes;
  };

  const classesAround = (symbol: CodeSymbol | null): CodeSymbol[] => {
    if (!symbol) return [];
    const known = around.get(symbol.id);
    if (known) return known;
    const classes = walkOut(symbol);
    around.set(symbol.id, classes);
    return classes;
  };

  const valueOf = (receiver: Receiver, reference: Reference): Value => {
    if (receiver.kind === 'outside') return OUTSIDE;
    if (receiver.kind === 'type') return hierarchy.typeOf(reference.file, receiver.type);
    if (receiver.kind !== 'result') return null;
    const call = calls.get(reference.file)?.get(receiver.of);
    const method = call ? hierarchy.callee(call) : undefined;
    const declared = method ? returnsOf.get(method.id) : undefined;
    return declared?.returns ? valueOf(declared.returns, declared) : null;
  };

  const memberFor = (reference: Reference, wanted: string): Member => {
    const { receiver } = reference;
    if (!receiver || (receiver.kind === 'self' && reference.link)) return null;
    const find = (owner: CodeSymbol): CodeSymbol | undefined => hierarchy.inherited(owner, wanted);
    if (receiver.kind === 'self') return firstMember(classesAround(reference.from), find);
    if (receiver.kind === 'parent') {
      const [own] = classesAround(reference.from);
      return own ? (firstMember(hierarchy.parentsOf(own), find) ?? OUTSIDE) : null;
    }
    const value = valueOf(receiver, reference);
    const exact = receiver.kind === 'outside' || ('exact' in receiver && receiver.exact === true);
    if (!value) return null;
    if ('outside' in value) return exact ? OUTSIDE : null;
    const found = find(value.symbol);
    if (found) return { target: found };
    return exact ? OUTSIDE : null;
  };

  return { memberFor };
}
