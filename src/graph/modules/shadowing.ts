import type { AstNode } from '../parser.js';
import type { InContext } from './binding.js';

export interface ShadowRules {
  scopes: ReadonlySet<string>;
  isBinding: InContext;
  isReleased?: InContext;
  scopeOf?: (node: AstNode, parent: AstNode) => AstNode | null;
  runsInside: (scope: AstNode, child: AstNode) => boolean;
}

export interface Shadows {
  node: (node: AstNode) => boolean;
  at: (name: string, line: number) => boolean;
}

type Shadowing = (nodes: readonly AstNode[]) => Shadows;

export const NOTHING: Shadows = { node: () => false, at: () => false };

const keyOf = (node: AstNode): string => {
  const { line, column } = node.range().start;
  return `${line}:${column}`;
};

export function shadowing(rules: ShadowRules): Shadowing {
  const nearest = (from: AstNode | null): AstNode | null => {
    for (let up = from; up; up = up.parent()) if (rules.scopes.has(up.kind())) return up;
    return null;
  };
  const scopeOf = rules.scopeOf ?? ((_node, parent) => nearest(parent));

  return (nodes) => {
    const bound = new Map<string, Set<string>>();
    const released = new Map<string, Set<string>>();
    const extent = new Map<string, { start: number; end: number }>();
    const note = (into: Map<string, Set<string>>, scope: AstNode, name: string): void => {
      const key = keyOf(scope);
      into.set(key, (into.get(key) ?? new Set()).add(name));
      const { start, end } = scope.range();
      extent.set(key, { start: start.line + 1, end: end.line + 1 });
    };

    for (const node of nodes) {
      const parent = node.parent();
      if (!parent) continue;
      const table = rules.isBinding(node, parent)
        ? bound
        : rules.isReleased?.(node, parent)
          ? released
          : null;
      const scope = table && scopeOf(node, parent);
      if (table && scope) note(table, scope, node.text());
    }
    if (bound.size === 0) return NOTHING;

    const holds = (key: string, name: string): boolean =>
      !!bound.get(key)?.has(name) && !released.get(key)?.has(name);
    const scopesOf = new Map<string, string[]>();
    for (const [key, names] of bound) {
      for (const name of names) scopesOf.set(name, [...(scopesOf.get(name) ?? []), key]);
    }

    return {
      node(node) {
        const name = node.text();
        if (!scopesOf.has(name)) return false;
        let child = node;
        for (let up = node.parent(); up; child = up, up = up.parent()) {
          if (!rules.scopes.has(up.kind()) || !rules.runsInside(up, child)) continue;
          if (holds(keyOf(up), name)) return true;
        }
        return false;
      },
      at: (name, line) =>
        (scopesOf.get(name) ?? []).some((key) => {
          const lines = extent.get(key);
          return !!lines && line >= lines.start && line <= lines.end && holds(key, name);
        }),
    };
  };
}
