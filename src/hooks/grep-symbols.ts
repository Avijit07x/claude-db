const SYMBOL =
  /^(?=.{4,})(?:[a-z]+(?:[A-Z][a-zA-Z0-9]*)+|[A-Z][a-z0-9]+(?:[A-Z][a-zA-Z0-9]*)*|[a-z][a-z0-9]*(?:_[a-z0-9]+)+)$/;
const WORD = /^[a-z][a-z0-9]{3,}$/;

export const DECLARED = new Set(['function', 'method', 'class', 'interface', 'type', 'enum']);
const GREP =
  /(?:^|[;&|(`]|\$\(|\bdo\s+|\bthen\s+|\belse\s+|\bxargs\s+|\bgit\s+|\bsudo\s+|\btime\s+|-exec\s+)\s*(?:grep|rg)\b((?:\s+(?:-[ABC]\s?\d+|-[tTg]\s\S+|-{1,2}[\w-]+(?:=\S+)?))*)\s+(?:(['"])(.+?)\2|(\S+))([^;&|]*)/gm;

export function isSymbol(pattern: string): boolean {
  return SYMBOL.test(pattern);
}

export function isWord(pattern: string): boolean {
  return WORD.test(pattern);
}

export function symbolsGreppedIn(command: string): string[] {
  const found = new Set<string>();
  for (const match of command.matchAll(GREP)) {
    const flags = match[1] ?? '';
    const pattern = match[3] ?? match[4] ?? '';
    const rest = match[5] ?? '';
    if (!SYMBOL.test(pattern) && !WORD.test(pattern)) continue;
    if (/-\w*v/.test(flags)) continue;
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
