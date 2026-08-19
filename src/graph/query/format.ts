import type { CodeEdge } from '../../types.js';
import type { GraphAnswer } from './lookup.js';

function tag(edge: CodeEdge): string {
  const score = edge.confidence === 'INFERRED' ? ` ${edge.score.toFixed(2)}` : '';
  return `[${edge.relation}] [${edge.confidence}${score}]`;
}

export function formatGraph(answer: GraphAnswer, root: string): string {
  if (answer.mode === 'path') {
    if (answer.path.length === 0) {
      return `No path found from "${answer.symbol}" to "${answer.target ?? ''}".`;
    }
    return [
      `Shortest path (${answer.path.length - 1} hops):`,
      `  ${answer.path.join(' --> ')}`,
    ].join('\n');
  }

  if (answer.empty) return `No symbol "${answer.symbol}" in the graph for ${root}.`;

  const lines: string[] = [];
  for (const definition of answer.definitions) {
    lines.push(`${definition.name}  [${definition.kind}]`);
    lines.push(`  Source: ${definition.file}:${definition.line}`);
    if (definition.signature) lines.push(`  ${definition.signature}`);
  }
  if (answer.definitions.length === 0) {
    lines.push(`${answer.symbol}  [no definition in this repository]`);
  }

  lines.push(`  Referenced by (${answer.inbound.length}):`);
  for (const edge of answer.inbound) {
    lines.push(`    <-- ${edge.srcName}  ${tag(edge)}  ${edge.file}:${edge.line}`);
  }

  if (answer.mode === 'explain') {
    lines.push(`  Reaches (${answer.outbound.length}):`);
    for (const edge of answer.outbound) {
      lines.push(`    --> ${edge.dstName}  ${tag(edge)}  ${edge.file}:${edge.line}`);
    }
  }

  if (answer.refreshed.length > 0) {
    lines.push(`  (re-parsed ${answer.refreshed.length} changed file(s) before answering)`);
  }
  return lines.join('\n');
}
