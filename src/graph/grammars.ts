import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { CONFIG_DIR } from '../config/dir.js';

export interface Grammar {
  readonly libraryPath: string;
}

export type Load = (id: string) => unknown;

export const GRAMMARS: readonly string[] = ['go', 'java', 'kotlin', 'python', 'ruby', 'rust'];
export const PLATFORM = `${process.platform}-${process.arch}`;
export const PLATFORM_PACKAGE = `claude-db-grammars-${PLATFORM}`;

const loaded = new Map<string, Grammar | null>();

export const grammarHome = (): string =>
  process.env.CLAUDE_DB_GRAMMARS ?? join(CONFIG_DIR, 'grammars');

const places = (): Load[] => [
  createRequire(import.meta.url),
  createRequire(join(grammarHome(), 'package.json')),
];

function fromPlatform(load: Load, name: string): unknown {
  const grammars = load(PLATFORM_PACKAGE) as Record<string, unknown>;
  return grammars[name];
}

function fromAstGrep(load: Load, name: string): unknown {
  const grammar = load(`@ast-grep/lang-${name}`) as { default?: unknown };
  return grammar.default ?? grammar;
}

function librarySize(grammar: unknown): number {
  try {
    const path = (grammar as Grammar).libraryPath;
    return typeof path === 'string' && path.length > 0 ? statSync(path).size : 0;
  } catch {
    return 0;
  }
}

export const isUsable = (grammar: unknown): grammar is Grammar => librarySize(grammar) > 0;

export function findGrammar(name: string, loads: readonly Load[]): Grammar | undefined {
  for (const read of [fromPlatform, fromAstGrep]) {
    for (const load of loads) {
      try {
        const grammar = read(load, name);
        if (isUsable(grammar)) return grammar;
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

export function loadGrammar(name: string): Grammar | undefined {
  if (!loaded.has(name)) loaded.set(name, findGrammar(name, places()) ?? null);
  return loaded.get(name) ?? undefined;
}

export const hasGrammar = (name: string): boolean => loadGrammar(name) !== undefined;

export const availableGrammars = (): string[] => GRAMMARS.filter(hasGrammar);

export function grammarSignature(): string {
  return availableGrammars()
    .map((name) => `${name}:${librarySize(loadGrammar(name))}`)
    .join(',');
}
