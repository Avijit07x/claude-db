import { observationId } from '../capture/identity.js';
import { redact } from '../capture/redact.js';
import type { CodeSymbol, SymbolKind } from '../types.js';

const SIGNATURE_CHARS = 200;
const SIGNATURE_WINDOW = 1000;

export function symbolId(
  project: string,
  file: string,
  name: string,
  kind: string,
  index = 0,
): string {
  const seed = `${project}\0${file}\0${name}\0${kind}`;
  return observationId('graph', 0, index === 0 ? seed : `${seed}\0${index}`);
}

function counter(): (name: string, kind: string) => number {
  const seen = new Map<string, number>();
  return (name, kind) => {
    const key = `${name}\0${kind}`;
    const index = seen.get(key) ?? 0;
    seen.set(key, index + 1);
    return index;
  };
}

export interface SymbolSource {
  project: string;
  path: string;
  lang: string;
  lines: string[];
}

export type Declare = (name: string, kind: SymbolKind, line: number) => CodeSymbol;

export function symbolFactory(source: SymbolSource): Declare {
  const occurrence = counter();
  return (name, kind, line) => ({
    id: symbolId(source.project, source.path, name, kind, occurrence(name, kind)),
    project: source.project,
    name,
    kind,
    file: source.path,
    line,
    lang: source.lang,
    signature: redact((source.lines[line - 1] ?? '').trim().slice(0, SIGNATURE_WINDOW)).slice(
      0,
      SIGNATURE_CHARS,
    ),
  });
}
