import type { LanguageSpec } from './rules.js';
import type { SymbolKind } from '../../types.js';

const LABELS: Record<string, string[]> = {
  c: ['.c', '.h'],
  cpp: ['.cc', '.cpp', '.cxx', '.hpp', '.hh'],
  csharp: ['.cs'],
  java: ['.java'],
  kotlin: ['.kt', '.kts'],
  swift: ['.swift'],
  'objective-c': ['.m', '.mm'],
  scala: ['.scala'],
  php: ['.php'],
  perl: ['.pl', '.pm'],
  lua: ['.lua'],
  r: ['.r', '.R'],
  julia: ['.jl'],
  dart: ['.dart'],
  elixir: ['.ex', '.exs'],
  erlang: ['.erl'],
  clojure: ['.clj', '.cljs', '.cljc'],
  haskell: ['.hs'],
  ocaml: ['.ml', '.mli'],
  fsharp: ['.fs', '.fsx'],
  groovy: ['.groovy', '.gradle'],
  shell: ['.sh', '.bash', '.zsh'],
  powershell: ['.ps1', '.psm1'],
  sql: ['.sql'],
  zig: ['.zig'],
  nim: ['.nim'],
  crystal: ['.cr'],
  solidity: ['.sol'],
  vala: ['.vala'],
};

const KEYWORDS: Record<string, SymbolKind> = {
  class: 'class',
  struct: 'class',
  object: 'class',
  record: 'class',
  actor: 'class',
  contract: 'class',
  module: 'class',
  defmodule: 'class',
  namespace: 'class',
  interface: 'interface',
  protocol: 'interface',
  trait: 'interface',
  typeclass: 'interface',
  enum: 'enum',
  type: 'type',
  typedef: 'type',
  data: 'type',
  newtype: 'type',
  def: 'function',
  defp: 'function',
  defn: 'function',
  defun: 'function',
  function: 'function',
  func: 'function',
  fn: 'function',
  sub: 'function',
  proc: 'function',
  method: 'method',
};

const DECLARATION = new RegExp(
  `^[\\t ]*(?:[\\w@\\[\\]]+[\\t ]+){0,3}(${Object.keys(KEYWORDS).join('|')})[\\t ]+([A-Za-z_][\\w]*)`,
);

const CALLABLE =
  /^[\t ]*(?:[A-Za-z_][\w:<>,.\[\]*&\t ]*[\t *&]+)?([A-Za-z_]\w*)[\t ]*\([^;=]*\)[\t ]*(?:const[\t ]*)?\{[\t ]*$/;

const CALL = /\b([A-Za-z_]\w{2,})[\t ]*\(/g;

const NOT_A_CALL = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'with',
  'else',
  'elsif',
  'unless',
  'until',
  'when',
  'case',
  'do',
  'end',
  'and',
  'not',
  'or',
  'sizeof',
  'typeof',
  'defined',
  'print',
  'printf',
  'echo',
  'assert',
  'require',
  'import',
  'include',
  'new',
  'delete',
  'throw',
  'super',
  'self',
  'this',
  ...Object.keys(KEYWORDS),
]);

export const BASIC_FINGERPRINT = [
  DECLARATION.source,
  CALLABLE.source,
  CALL.source,
  Object.keys(LABELS).join(','),
].join('|');

export const BASIC_LANGUAGES: LanguageSpec[] = Object.entries(LABELS).map(
  ([label, extensions]) => ({
    id: 'basic',
    label,
    extensions,
    definitions: [],
    references: [],
    basic: true,
  }),
);

export interface BasicDeclaration {
  name: string;
  kind: SymbolKind;
  line: number;
}

export function declarationsIn(source: string): BasicDeclaration[] {
  const found: BasicDeclaration[] = [];
  const lines = source.split('\n');

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    if (line.length > 400) continue;

    const keyword = DECLARATION.exec(line);
    if (keyword) {
      const kind = KEYWORDS[keyword[1] ?? ''];
      const name = keyword[2];
      if (kind && name && !KEYWORDS[name]) found.push({ name, kind, line: index + 1 });
      continue;
    }

    const callable = CALLABLE.exec(line);
    const name = callable?.[1];
    if (name && !NOT_A_CALL.has(name)) found.push({ name, kind: 'function', line: index + 1 });
  }
  return found;
}

const MAX_CALLS = 200;

export function callsIn(source: string): BasicDeclaration[] {
  const found: BasicDeclaration[] = [];
  const lines = source.split('\n');

  for (let index = 0; index < lines.length && found.length < MAX_CALLS; index++) {
    const line = lines[index] ?? '';
    if (line.length > 400) continue;
    if (DECLARATION.test(line) || CALLABLE.test(line)) continue;

    for (const match of line.matchAll(CALL)) {
      const name = match[1];
      if (!name || NOT_A_CALL.has(name)) continue;
      found.push({ name, kind: 'function', line: index + 1 });
    }
  }
  return found;
}
