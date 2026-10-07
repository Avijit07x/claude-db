import { createRequire } from 'node:module';
import { GRAMMARS, loadGrammar } from './grammars.js';

export interface AstPosition {
  line: number;
  column: number;
  index: number;
}

export interface AstRange {
  start: AstPosition;
  end: AstPosition;
}

export interface AstNode {
  text(): string;
  kind(): string;
  range(): AstRange;
  field(name: string): AstNode | null;
  parent(): AstNode | null;
  children(): AstNode[];
  findAll(matcher: { rule: Record<string, unknown> }): AstNode[];
}

interface AstGrepModule {
  parse(language: unknown, source: string): { root(): AstNode };
  registerDynamicLanguage(languages: Record<string, unknown>): void;
  Lang: Record<string, unknown>;
}

let cached: AstGrepModule | null = null;

export function loadParser(): AstGrepModule {
  if (cached) return cached;

  const require = createRequire(import.meta.url);
  let parser: AstGrepModule;
  try {
    parser = require('@ast-grep/napi') as AstGrepModule;
  } catch (error) {
    throw new Error(
      'ast-grep failed to load, so the code graph cannot be built. It ships ' +
        'as a prebuilt binary per platform, so this usually means this one is ' +
        `unsupported: ${process.platform}/${process.arch}. ` +
        `(${error instanceof Error ? error.message.split('\n')[0] : String(error)})`,
      { cause: error },
    );
  }

  const dynamic: Record<string, unknown> = {};
  for (const name of GRAMMARS) {
    const grammar = loadGrammar(name);
    if (grammar) dynamic[name] = grammar;
  }
  parser.registerDynamicLanguage(dynamic);

  cached = parser;
  return parser;
}

export function languageHandle(parser: AstGrepModule, id: string): unknown {
  return parser.Lang[id] ?? id;
}
