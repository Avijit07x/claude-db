import type { CodeEdge, CodeSymbol } from '../../types.js';
import { observationId } from '../../capture/identity.js';
import { lastSegment } from '../modules/names.js';
import { createModuleContext } from '../modules/registry.js';
import type { ModuleContext } from '../modules/system.js';
import type { Reference } from '../types.js';
import { createBinder } from './binder.js';

export interface Linker {
  edgesFor(references: Reference[]): CodeEdge[];
  outcome(reference: Reference): string;
}

function edgeId(
  project: string,
  file: string,
  line: number,
  from: string,
  to: string,
  relation: string,
  origin: string,
): string {
  return observationId(
    'graph',
    0,
    `${project}\0${file}\0${line}\0${from}\0${to}\0${relation}\0${origin}`,
  );
}

export function createLinker(
  project: string,
  symbols: CodeSymbol[],
  references: Reference[],
  modules?: ModuleContext,
): Linker {
  const context = modules ?? createModuleContext('', new Set(symbols.map((symbol) => symbol.file)));
  const binder = createBinder(symbols, references, context);

  const outcome = (reference: Reference): string => {
    const resolution = binder.resolve(reference);
    if (!resolution) return '';
    const external = resolution.external ? 1 : 0;
    return `${resolution.target?.id ?? ''}|${resolution.confidence}|${resolution.score}|${external}`;
  };

  const edgesFor = (batch: Reference[]): CodeEdge[] => {
    const edges: CodeEdge[] = [];
    const origins = new Map<string, string>();
    const sealed = new Set<string>();
    for (const reference of batch) {
      const resolution = binder.resolve(reference);
      if (!resolution) continue;

      const fromName = reference.from?.name ?? reference.file;
      const edge: CodeEdge = {
        id: edgeId(
          project,
          reference.file,
          reference.line,
          fromName,
          reference.name,
          reference.relation,
          reference.origin ?? '',
        ),
        project,
        srcId: reference.from?.id ?? '',
        srcName: fromName,
        dstId: resolution.target?.id ?? '',
        dstName: reference.name,
        relation: reference.relation,
        confidence: resolution.confidence,
        score: resolution.score,
        file: reference.file,
        line: reference.line,
      };
      edges.push(edge);
      if (reference.origin !== undefined) origins.set(edge.id, reference.origin);
      if (resolution.external) sealed.add(edge.id);
    }
    return mergeMemberCalls(edges, origins, sealed);
  };

  return { edgesFor, outcome };
}

export function resolveEdges(
  project: string,
  symbols: CodeSymbol[],
  references: Reference[],
  modules?: ModuleContext,
): CodeEdge[] {
  return createLinker(project, symbols, references, modules).edgesFor(references);
}

function mergeMemberCalls(
  edges: CodeEdge[],
  origins: Map<string, string>,
  sealed: Set<string>,
): CodeEdge[] {
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
      const tail = lastSegment(qualified.dstName);
      if (tail === qualified.dstName) continue;
      for (const bare of bucket) {
        if (bare === qualified) continue;
        if (bare.dstName !== tail || bare.relation !== qualified.relation) continue;
        const from = origins.get(qualified.id);
        const to = origins.get(bare.id);
        if (from === undefined || to === undefined || from !== to) continue;
        if (!qualified.dstId && bare.dstId && !sealed.has(qualified.id)) {
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
