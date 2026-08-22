import type { CodeEdge, CodeSymbol } from '../../types.js';
import { observationId } from '../../capture/identity.js';
import type { Reference } from './extract.js';

const SAME_FILE = 1;
const SINGLE_MATCH = 0.95;
const AMBIGUOUS_MATCH = 0.85;

function edgeId(project: string, file: string, line: number, from: string, to: string): string {
  return observationId('graph', 0, `${project}\0${file}\0${line}\0${from}\0${to}`);
}

export function resolveEdges(
  project: string,
  symbols: CodeSymbol[],
  references: Reference[],
): CodeEdge[] {
  const byName = new Map<string, CodeSymbol[]>();
  for (const symbol of symbols) {
    const bucket = byName.get(symbol.name);
    if (bucket) bucket.push(symbol);
    else byName.set(symbol.name, [symbol]);
  }

  const edges: CodeEdge[] = [];
  for (const reference of references) {
    const candidates = byName.get(reference.name) ?? [];
    const local = candidates.find((candidate) => candidate.file === reference.file);
    const target = local ?? candidates[0];
    if (!target && reference.weak) continue;

    let confidence: CodeEdge['confidence'] = 'EXTRACTED';
    let score = SAME_FILE;
    if (!local && candidates.length === 1) {
      confidence = 'INFERRED';
      score = SINGLE_MATCH;
    } else if (!local && candidates.length > 1) {
      confidence = 'INFERRED';
      score = AMBIGUOUS_MATCH;
    }

    const fromName = reference.from?.name ?? reference.file;
    edges.push({
      id: edgeId(project, reference.file, reference.line, fromName, reference.name),
      project,
      srcId: reference.from?.id ?? '',
      srcName: fromName,
      dstId: target?.id ?? '',
      dstName: reference.name,
      relation: reference.relation,
      confidence,
      score,
      file: reference.file,
      line: reference.line,
    });
  }
  return mergeMemberCalls(edges);
}

function mergeMemberCalls(edges: CodeEdge[]): CodeEdge[] {
  const byLine = new Map<string, CodeEdge[]>();
  for (const edge of edges) {
    const key = `${edge.file}\0${edge.line}`;
    const bucket = byLine.get(key);
    if (bucket) bucket.push(edge);
    else byLine.set(key, [edge]);
  }

  const merged = new Set<string>();
  for (const bucket of byLine.values()) {
    for (const qualified of bucket) {
      const dot = qualified.dstName.lastIndexOf('.');
      if (dot < 0) continue;
      const tail = qualified.dstName.slice(dot + 1);
      for (const bare of bucket) {
        if (bare === qualified) continue;
        if (bare.dstName !== tail || bare.relation !== qualified.relation) continue;
        if (!qualified.dstId && bare.dstId) {
          qualified.dstId = bare.dstId;
          qualified.confidence = bare.confidence;
          qualified.score = bare.score;
        }
        merged.add(bare.id);
      }
    }
  }
  return edges.filter((edge) => !merged.has(edge.id));
}
