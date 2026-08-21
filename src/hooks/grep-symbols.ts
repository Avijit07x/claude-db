const SYMBOL =
  /^(?=.{4,})(?:[a-z]+(?:[A-Z][a-zA-Z0-9]*)+|[A-Z][a-z0-9]+(?:[A-Z][a-zA-Z0-9]*)*|[a-z][a-z0-9]*(?:_[a-z0-9]+)+)$/;
const WORD = /^[a-z][a-z0-9]{3,}$/;
const GREP = /\b(?:grep|rg)\b((?:\s+-{1,2}[\w-]+(?:=\S+)?)*)\s+(?:(['"])(.+?)\2|(\S+))([^;&|]*)/g;

export function isSymbol(pattern: string): boolean {
  return SYMBOL.test(pattern);
}

export function isWord(pattern: string): boolean {
  return WORD.test(pattern);
}

/** Symbols a shell command searches the tree for, which the code graph also answers. */
export function symbolsGreppedIn(command: string): string[] {
  const found = new Set<string>();
  for (const match of command.matchAll(GREP)) {
    const flags = match[1] ?? '';
    const pattern = match[3] ?? match[4] ?? '';
    const rest = match[5] ?? '';
    if (!SYMBOL.test(pattern) && !WORD.test(pattern)) continue;
    if (/-\w*v/.test(flags)) continue;
    const searchesTree =
      /-\w*[rR]\b|--recursive/.test(flags) ||
      /^\s+[^-|;&>][^\s|;&>]*/.test(rest) ||
      /\bgit\s+$/.test(command.slice(0, match.index));
    if (searchesTree) found.add(pattern);
  }
  return [...found].sort();
}
