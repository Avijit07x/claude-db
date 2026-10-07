import { findUsages } from '../../usages/find.js';
import type { CodeEdge, CodeSymbol } from '../../types.js';

const SCAN_LIMIT = 2000;

export interface TextLine {
  file: string;
  line: number;
  text: string;
}

export interface TextMatches {
  lines: TextLine[];
  truncated: boolean;
  error?: string;
}

const lineKey = (file: string, line: number): string => `${file}\0${line}`;

function explainedLines(definitions: CodeSymbol[], inbound: CodeEdge[]): Set<string> {
  const explained = new Set<string>();
  for (const definition of definitions) explained.add(lineKey(definition.file, definition.line));
  for (const edge of inbound) explained.add(lineKey(edge.file, edge.line));
  return explained;
}

export function unlinkedText(
  root: string,
  symbol: string,
  definitions: CodeSymbol[],
  inbound: CodeEdge[],
): TextMatches {
  let result;
  try {
    result = findUsages({ symbol, path: root, regex: false, context: 0, limit: SCAN_LIMIT });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { lines: [], truncated: false, error: reason };
  }
  const explained = explainedLines(definitions, inbound);
  const lines = result.matches
    .filter((match) => !explained.has(lineKey(match.file, match.line)))
    .map((match) => ({ file: match.file, line: match.line, text: match.text.trim() }));
  return { lines, truncated: result.truncated };
}
