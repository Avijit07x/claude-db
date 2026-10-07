import type { AstNode } from '../../parser.js';

const SOURCE_DEPTH = 4;
const QUOTES = /^['"`]|['"`]$/g;

export function stripQuotes(text: string): string {
  return text.replace(QUOTES, '');
}

export function moduleOf(node: AstNode): string | undefined {
  let current: AstNode | null = node;
  for (let depth = 0; current && depth < SOURCE_DEPTH; depth += 1) {
    const source = current.field('source');
    if (source) return stripQuotes(source.text());
    current = current.parent();
  }
  return undefined;
}
