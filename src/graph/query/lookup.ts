import type { MemoryStore } from '../../store/adapter.js';
import type { CodeEdge, CodeSymbol } from '../../types.js';
import { shortestPath } from './path.js';

export type GraphMode = 'usages' | 'explain' | 'path';

export interface GraphAnswer {
  mode: GraphMode;
  symbol: string;
  target?: string;
  definitions: CodeSymbol[];
  inbound: CodeEdge[];
  outbound: CodeEdge[];
  path: string[];
  refreshed: string[];
  empty: boolean;
}

export interface GraphQuery {
  mode: GraphMode;
  symbol: string;
  target?: string;
  limit: number;
}

export async function queryGraph(
  store: MemoryStore,
  project: string,
  query: GraphQuery,
): Promise<GraphAnswer> {
  const answer: GraphAnswer = {
    mode: query.mode,
    symbol: query.symbol,
    definitions: [],
    inbound: [],
    outbound: [],
    path: [],
    refreshed: [],
    empty: false,
  };

  if (query.mode === 'path') {
    if (query.target) answer.target = query.target;
    answer.path = await shortestPath(store, project, query.symbol, query.target ?? '');
    answer.empty = answer.path.length === 0;
    return answer;
  }

  answer.definitions = await store.findSymbols({
    project,
    name: query.symbol,
    limit: query.limit,
  });

  const ids = answer.definitions.map((symbol) => symbol.id);
  const edges = await store.findEdges({
    project,
    ...(ids.length > 0 ? { srcIds: ids, dstIds: ids } : {}),
    limit: Math.max(query.limit * 10, 500),
  });

  answer.inbound = edges.filter((edge) => edge.dstName === query.symbol);
  answer.outbound = edges.filter(
    (edge) => ids.includes(edge.srcId) && edge.dstName !== query.symbol,
  );
  answer.empty = answer.definitions.length === 0 && answer.inbound.length === 0;
  return answer;
}
