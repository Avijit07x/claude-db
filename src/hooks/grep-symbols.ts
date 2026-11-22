import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

export type PathCheck = (path: string) => boolean;

const SYMBOL =
  /^(?=.{4,})(?:[a-z]+(?:[A-Z][a-zA-Z0-9]*)+|[A-Z][a-z0-9]+(?:[A-Z][a-zA-Z0-9]*)*|[a-z][a-z0-9]*(?:_[a-z0-9]+)+)$/;
const WORD = /^[a-z][a-z0-9]{3,}$/;

export const DECLARED = new Set(['function', 'method', 'class', 'interface', 'type', 'enum']);
const GREP =
  /(?:^|[;&|(`]|\$\(|\bdo\s+|\bthen\s+|\belse\s+|\bxargs\s+|\bgit\s+|\bsudo\s+|\btime\s+|-exec\s+)\s*(?:grep|rg)\b((?:\s+(?:-[ABC]\s?\d+|-[tTg]\s\S+|-{1,2}[\w-]+(?:=\S+)?))*)\s+(?:(['"])(.+?)\2|(\S+))([^;&|]*)/gm;

const COUNT_OR_INVERT = /(?:^|\s)-[A-Za-z]*[cv]|--invert-match|--count/;
const OPERATOR_ONLY = /^\d*[<>]+$/;
const REDIRECT = /^\d*[<>]/;
const COMMAND_END = /;|&&|\|\||\n/;

const isOption = (token: string): boolean => token.startsWith('-');

function argumentsOf(rest: string): string[] {
  const tokens = (rest.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((token) =>
    token.replace(/^(['"])(.*)\1$/, '$2'),
  );
  const kept: string[] = [];
  let skipNext = false;
  for (const token of tokens) {
    if (skipNext) skipNext = false;
    else if (OPERATOR_ONLY.test(token)) skipNext = true;
    else if (!REDIRECT.test(token)) kept.push(token);
  }
  return kept;
}

const pipesOutput = (command: string, end: number): boolean =>
  (command.slice(end).split(COMMAND_END)[0] ?? '').includes('|');

export function repoDirectory(cwd: string, root: string): PathCheck {
  return (path) => {
    try {
      const target = realpathSync(resolve(cwd, path));
      const scope = relative(realpathSync(root), target);
      return !scope.startsWith('..') && !isAbsolute(scope) && statSync(target).isDirectory();
    } catch {
      return false;
    }
  };
}

export function isSymbol(pattern: string): boolean {
  return SYMBOL.test(pattern);
}

export function isWord(pattern: string): boolean {
  return WORD.test(pattern);
}

export function symbolsGreppedIn(command: string, pathOk: PathCheck = () => true): string[] {
  const found = new Set<string>();
  for (const match of command.matchAll(GREP)) {
    const flags = match[1] ?? '';
    const pattern = match[3] ?? match[4] ?? '';
    const rest = match[5] ?? '';
    if (!SYMBOL.test(pattern) && !WORD.test(pattern)) continue;
    const args = argumentsOf(rest);
    if (COUNT_OR_INVERT.test([flags, ...args.filter(isOption)].join(' '))) continue;
    if (pipesOutput(command, match.index + match[0].length)) continue;
    if (!args.filter((arg) => !isOption(arg)).every(pathOk)) continue;
    const invocation = match[0];
    const piped = /^\s*\|/.test(invocation);
    const searchesTree =
      /-\w*[rR]\b|--recursive/.test(flags) ||
      /^\s+[^-|;&>][^\s|;&>]*/.test(rest) ||
      /\bgit\s+(?:grep|rg)\b/.test(invocation) ||
      (/(?:^|[\s;&|(])rg\b/.test(invocation) && !piped);
    if (searchesTree) found.add(pattern);
  }
  return [...found].sort();
}
