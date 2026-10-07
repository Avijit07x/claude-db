import type { CodeEdge } from '../../types.js';
import { importsNames, isTracked } from '../modules/registry.js';
import type { DefinitionGroup } from './groups.js';
import { groupByDefinition } from './groups.js';
import type { GraphAnswer } from './lookup.js';
import { formatSuggestions } from './suggest.js';
import type { TextMatches } from './text.js';

export const TEXT_SHOWN = 20;
const TEXT_WIDTH = 160;

export interface FormatOptions {
  text?: boolean;
  textShown?: number;
}

function tag(edge: CodeEdge): string {
  const score = edge.confidence === 'INFERRED' ? ` ${edge.score.toFixed(2)}` : '';
  return `[${edge.relation}] [${edge.confidence}${score}]`;
}

const referenceLine = (edge: CodeEdge): string =>
  `    <-- ${edge.srcName}  ${tag(edge)}  ${edge.file}:${edge.line}`;

const importLine = (edge: CodeEdge): string => `    <-- ${edge.file}:${edge.line}  ${tag(edge)}`;

const edgeLine = (edge: CodeEdge): string =>
  edge.relation === 'imports' ? importLine(edge) : referenceLine(edge);

const reachLine = (edge: CodeEdge): string =>
  `    --> ${edge.dstName}  ${tag(edge)}  ${edge.file}:${edge.line}`;

function definitionLines(group: DefinitionGroup, mode: GraphAnswer['mode']): string[] {
  const { definition } = group;
  const lines = [
    `${definition.name}  [${definition.kind}]`,
    `  Source: ${definition.file}:${definition.line}`,
  ];
  if (definition.signature) lines.push(`  ${definition.signature}`);
  for (const owner of group.owners) lines.push(`  Member of: ${owner.srcName}`);
  lines.push(
    `  Referenced by (${group.references.length}):`,
    ...group.references.map(referenceLine),
  );
  if (importsNames(definition.lang)) {
    lines.push(`  Imported by (${group.imports.length}):`, ...group.imports.map(importLine));
  }
  if (!isTracked(definition.lang)) {
    lines.push(`  Imports are not tracked yet for: ${definition.lang}`);
  }
  if (mode === 'explain') {
    lines.push(`  Reaches (${group.reaches.length}):`, ...group.reaches.map(reachLine));
  }
  return lines;
}

function withoutDefinitionLines(symbol: string, unbound: CodeEdge[]): string[] {
  const imported = unbound.filter((edge) => edge.relation === 'imports');
  const referenced = unbound.filter((edge) => edge.relation !== 'imports');
  return [
    `${symbol}  [no definition in this repository]`,
    `  Referenced by (${referenced.length}):`,
    ...referenced.map(referenceLine),
    `  Imported by (${imported.length}):`,
    ...imported.map(importLine),
  ];
}

function guessedLines(guessed: CodeEdge[], definitions: number): string[] {
  if (guessed.length === 0) return [];
  return [
    `Matched by name, could be any of the ${definitions} definitions above (${guessed.length}):`,
    ...guessed.map(edgeLine),
  ];
}

function unboundLines(unbound: CodeEdge[]): string[] {
  if (unbound.length === 0) return [];
  return [
    `Matched by name, not linked to one definition (${unbound.length}):`,
    ...unbound.map(edgeLine),
  ];
}

function textHeading(text: TextMatches, shown: number): string {
  const count = `${text.lines.length}${text.truncated ? '+' : ''}`;
  if (text.lines.length > shown) return `Text matches, not linked (showing ${shown} of ${count}):`;
  return `Text matches, not linked (${count}):`;
}

export function formatText(text: TextMatches | undefined, shown = TEXT_SHOWN): string[] {
  if (!text) return [];
  if (text.error) return [`Text matches: not searched (${text.error})`];
  if (text.lines.length === 0) return [];
  return [
    textHeading(text, shown),
    ...text.lines
      .slice(0, shown)
      .map((line) => `    ${line.file}:${line.line}  ${line.text.slice(0, TEXT_WIDTH)}`),
  ];
}

function pathLines(answer: GraphAnswer): string[] {
  if (answer.path.length === 0) {
    return [
      `No path found from "${answer.symbol}" to "${answer.target ?? ''}".` +
        formatSuggestions(answer.suggestions),
    ];
  }
  return [`Shortest path (${answer.path.length - 1} hops):`, `  ${answer.path.join(' --> ')}`];
}

function graphLines(answer: GraphAnswer, root: string): string[] {
  if (answer.empty) {
    return [
      `No symbol "${answer.symbol}" in the graph for ${root}.` +
        formatSuggestions(answer.suggestions),
    ];
  }
  const { groups, guessed, unbound } = groupByDefinition(
    answer.definitions,
    answer.inbound,
    answer.outbound,
  );
  if (groups.length === 0) return withoutDefinitionLines(answer.symbol, unbound);
  return [
    ...groups.flatMap((group) => definitionLines(group, answer.mode)),
    ...guessedLines(guessed, groups.length),
    ...unboundLines(unbound),
  ];
}

export function formatGraph(
  answer: GraphAnswer,
  root: string,
  options: FormatOptions = {},
): string {
  if (answer.mode === 'path') return pathLines(answer).join('\n');
  const lines = graphLines(answer, root);
  if (options.text !== false) lines.push(...formatText(answer.text, options.textShown));
  if (answer.refreshed.length > 0) {
    lines.push(`  (re-parsed ${answer.refreshed.length} changed file(s) before answering)`);
  }
  return lines.join('\n');
}
