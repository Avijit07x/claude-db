import type { CodeSymbol, EdgeRelation } from '../../types.js';
import type { AstNode } from '../parser.js';
import type { Reference } from '../types.js';
import type { Grammar, ImportFacts, Target } from './binding.js';
import { targetOf, visible } from './rebind.js';
import type { Shadows } from './shadowing.js';

const OBJECT_KINDS = new Set(['enum', 'class']);

export type Make = (
  node: AstNode,
  target: Target,
  relation: EdgeRelation,
  span?: AstNode,
) => Reference;

export interface Scope {
  facts: ImportFacts;
  locals: Set<string>;
  objects: Set<string>;
}

const escaped = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function scopeOf(
  root: AstNode,
  symbols: CodeSymbol[],
  facts: ImportFacts,
  grammar: Grammar,
): Scope {
  const bare = symbols.filter((symbol) => symbol.kind !== 'method');
  const locals = grammar.localNames?.(root) ?? new Set(bare.map((symbol) => symbol.name));
  const objects = new Set(
    bare.filter((symbol) => OBJECT_KINDS.has(symbol.kind)).map((symbol) => symbol.name),
  );
  return { facts, locals, objects };
}

export function usesIn(
  found: AstNode[],
  scope: Scope,
  grammar: Grammar,
  make: Make,
  shadows: Shadows,
): Reference[] {
  const { facts, locals, objects } = scope;

  const through = (
    node: AstNode,
    parent: AstNode,
    specifier: string,
    entered: string[],
  ): Reference[] => {
    const chain = grammar.memberChain(parent);
    return chain.map((name, at) => {
      const link = { specifier, via: [...entered, ...chain.slice(0, at)], strict: true };
      return make(node, { name, link }, 'references');
    });
  };

  const useOf = (node: AstNode): Reference[] => {
    const text = node.text();
    const parent = node.parent();
    if (!parent) return [];
    const line = (): number => node.range().start.line + 1;

    if (grammar.unbound?.claims?.(node, parent)) {
      const claimed = grammar.unbound.target(node, parent, facts);
      return claimed ? [make(node, claimed, 'references')] : [];
    }

    const imported = visible(facts.named.get(text), line);
    if (node.kind() === grammar.shorthand) {
      return imported ? [make(node, targetOf(imported, text), 'references')] : [];
    }
    if (imported && grammar.isUse(node, parent)) {
      const used = make(node, targetOf(imported, text), 'references');
      const reached = grammar.isMemberObject(node, parent)
        ? through(node, parent, imported.link.specifier, [imported.name])
        : [];
      return [used, ...reached];
    }

    const space = visible(facts.spaces.get(text), line);
    if (space && grammar.isMemberObject(node, parent)) {
      return through(node, parent, space.specifier, []);
    }

    const known = imported ?? space ?? (locals.has(text) || objects.has(text));
    if (!known) {
      const free = grammar.unbound?.target(node, parent, facts);
      return free ? [make(node, free, 'references')] : [];
    }

    const local =
      (locals.has(text) && grammar.isLocalUse(node, parent)) ||
      (objects.has(text) && grammar.isMemberObject(node, parent));
    return local ? [make(node, { name: text }, 'references')] : [];
  };

  return found.filter((node) => !shadows.node(node)).flatMap(useOf);
}

export function findUses(root: AstNode, scope: Scope, grammar: Grammar): AstNode[] {
  const { facts, locals } = scope;
  const names = [...facts.named.keys(), ...facts.spaces.keys(), ...locals].map(escaped).join('|');
  const known = { any: grammar.kinds.map((kind) => ({ kind })), regex: `^(?:${names})$` };
  if (!grammar.unbound) return root.findAll({ rule: known });
  return root.findAll({ rule: { any: [known, ...grammar.unbound.rules] } });
}
