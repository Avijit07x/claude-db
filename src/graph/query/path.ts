import type { MemoryStore } from '../../store/adapter.js';

const MAX_EDGES = 20000;
const MAX_SYMBOLS = 20000;

interface GraphologyGraph {
  hasNode(node: string): boolean;
  mergeDirectedEdge(from: string, to: string): unknown;
}

export async function shortestPath(
  store: MemoryStore,
  project: string,
  from: string,
  to: string,
): Promise<string[]> {
  if (!from || !to) return [];
  if (from === to) return [from];

  const graphology = (await import('graphology')) as unknown as {
    default: new (options: Record<string, unknown>) => GraphologyGraph;
  };
  const Graph = graphology.default;
  const { bidirectional } = (await import('graphology-shortest-path/unweighted.js')) as unknown as {
    bidirectional(graph: GraphologyGraph, from: string, to: string): string[] | null;
  };

  const [symbols, edges] = await Promise.all([
    store.findSymbols({ project, limit: MAX_SYMBOLS }),
    store.findEdges({ project, limit: MAX_EDGES }),
  ]);

  const label = new Map<string, string>();
  for (const symbol of symbols) label.set(symbol.id, symbol.name);

  const graph = new Graph({ type: 'directed', multi: false, allowSelfLoops: false });

  const nodeFor = (id: string, name: string): string => (id ? id : `name:${name}`);

  for (const edge of edges) {
    const src = nodeFor(edge.srcId, edge.srcName);
    const dst = nodeFor(edge.dstId, edge.dstName);
    if (src === dst) continue;
    graph.mergeDirectedEdge(src, dst);
  }

  const endpoints = (name: string): string[] => {
    const ids = symbols.filter((symbol) => symbol.name === name).map((symbol) => symbol.id);
    const nodes = ids.filter((id) => graph.hasNode(id));
    const unresolved = `name:${name}`;
    if (graph.hasNode(unresolved)) nodes.push(unresolved);
    return nodes;
  };

  let best: string[] | null = null;
  for (const start of endpoints(from)) {
    for (const end of endpoints(to)) {
      if (start === end) continue;
      const found = bidirectional(graph, start, end);
      if (found && (!best || found.length < best.length)) best = found;
    }
  }
  if (!best) return [];

  return best.map((node) => label.get(node) ?? node.replace(/^name:/, ''));
}
