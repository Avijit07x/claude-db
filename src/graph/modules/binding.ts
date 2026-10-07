import type { CodeSymbol } from '../../types.js';
import { originFrom } from '../ast.js';
import type { AstNode } from '../parser.js';
import type { ModuleLink, Reference } from '../types.js';
import { rebind } from './rebind.js';
import { NOTHING } from './shadowing.js';
import type { Shadows } from './shadowing.js';
import { findUses, scopeOf, usesIn } from './uses.js';
import type { Make } from './uses.js';

export type InContext = (node: AstNode, parent: AstNode) => boolean;

export interface Lines {
  start: number;
  end: number;
}

export interface Imported {
  name: string;
  link: ModuleLink;
  within?: Lines;
}

export interface Namespace {
  specifier: string;
  within?: Lines;
}

export interface ImportSite {
  at: AstNode;
  span: AstNode;
  imported: Imported;
}

export interface ImportFacts {
  named: Map<string, Imported[]>;
  spaces: Map<string, Namespace[]>;
  opens: string[];
  sites: ImportSite[];
}

export interface Target {
  name: string;
  link?: ModuleLink;
}

export interface Unbound {
  rules: readonly Record<string, unknown>[];
  claims?: InContext;
  target: (node: AstNode, parent: AstNode, facts: ImportFacts) => Target | undefined;
  reference: (reference: Reference, facts: ImportFacts) => Target | undefined;
}

export interface Grammar {
  kinds: readonly string[];
  shorthand?: string;
  isUse: InContext;
  isLocalUse: InContext;
  isMemberObject: InContext;
  memberChain: (parent: AstNode) => string[];
  localNames?: (root: AstNode) => Set<string>;
  shadowing?: (nodes: readonly AstNode[]) => Shadows;
  unbound?: Unbound;
}

export interface BindInput {
  root: AstNode;
  path: string;
  references: Reference[];
  symbols: CodeSymbol[];
  owner: (line: number) => CodeSymbol | null;
}

export function newFacts(): ImportFacts {
  return { named: new Map(), spaces: new Map(), opens: [], sites: [] };
}

const append = <T>(into: Map<string, T[]>, key: string, value: T): void => {
  into.set(key, [...(into.get(key) ?? []), value]);
};

export const addNamed = (facts: ImportFacts, local: string, imported: Imported): void =>
  append(facts.named, local, imported);

export const addSpace = (facts: ImportFacts, local: string, space: Namespace): void =>
  append(facts.spaces, local, space);

export function bindModule(input: BindInput, facts: ImportFacts, grammar: Grammar): Reference[] {
  const { root, path, references, symbols, owner } = input;
  const scope = scopeOf(root, symbols, facts, grammar);
  const nothingBound =
    facts.named.size === 0 &&
    facts.spaces.size === 0 &&
    facts.sites.length === 0 &&
    scope.locals.size === 0 &&
    !grammar.unbound;
  if (nothingBound) return references;

  const make: Make = (node, target, relation, span = node) => {
    const range = node.range();
    const line = range.start.line + 1;
    return {
      file: path,
      name: target.name,
      relation,
      line,
      from: owner(line),
      origin: originFrom(span === node ? range : span.range()),
      ...(target.link ? { link: target.link } : {}),
    };
  };

  const found = findUses(root, scope, grammar);
  const shadows = grammar.shadowing?.(found) ?? NOTHING;

  return [
    ...references.map((reference) => rebind(reference, facts, shadows, grammar.unbound)),
    ...facts.sites.map((site) => make(site.at, site.imported, 'imports', site.span)),
    ...usesIn(found, scope, grammar, make, shadows),
  ];
}
