import type { AstNode, AstRange } from './parser.js';

export function sameNode(a: AstNode | null, b: AstNode): boolean {
  if (!a) return false;
  const left = a.range().start;
  const right = b.range().start;
  return left.line === right.line && left.column === right.column;
}

export function originFrom({ start, end }: AstRange): string {
  return `${start.line}:${start.column}-${end.line}:${end.column}`;
}

export const originOf = (node: AstNode): string => originFrom(node.range());
