import type { MemoryStore } from '../../store/adapter.js';
import type { CodeEdge, CodeSymbol } from '../../types.js';
import { shortestPath } from './path.js';
import { suggestFor } from './suggest.js';

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
  suggestions: string[];
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
    suggestions: [],
  };

  if (query.mode === 'path') {
    if (query.target) answer.target = query.target;
    answer.path = await shortestPath(store, project, query.symbol, query.target ?? '');
    answer.empty = answer.path.length === 0;
    if (answer.empty) answer.suggestions = await suggestFor(store, project, query.symbol);
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
    ...(ids.length > 0 ? { srcIds: ids, dstIds: ids } : { dstName: query.symbol }),
    limit: Math.max(query.limit * 10, 500),
  });

  const idSet = new Set(ids);
  const pointsAtSymbol = (edge: (typeof edges)[number]): boolean =>
    edge.dstName === query.symbol ||
    edge.dstName.endsWith(`.${query.symbol}`) ||
    (edge.dstId !== '' && idSet.has(edge.dstId));

  answer.inbound = edges.filter(pointsAtSymbol);
  answer.outbound = edges.filter((edge) => idSet.has(edge.srcId) && !pointsAtSymbol(edge));
  answer.empty = answer.definitions.length === 0 && answer.inbound.length === 0;
  if (answer.empty) answer.suggestions = await suggestFor(store, project, query.symbol);
  return answer;
}
