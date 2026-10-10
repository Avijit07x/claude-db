import type { MemoryStore } from '../../store/adapter.js';
import type { CodeEdge, CodeSymbol } from '../../types.js';
import { shortestPath } from './path.js';
import { suggestFor } from './suggest.js';
import type { TextMatches } from './text.js';

const ALIAS_DEPTH = 3;

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
  text?: TextMatches;
}

export interface GraphQuery {
  mode: GraphMode;
  symbol: string;
  target?: string;
  limit: number;
  suggest?: boolean;
}

const aliasIds = (edges: CodeEdge[]): string[] =>
  edges.filter((edge) => edge.relation === 'aliases').map((edge) => edge.srcId);

async function throughAliases(
  store: MemoryStore,
  project: string,
  inbound: CodeEdge[],
  limit: number,
): Promise<CodeEdge[]> {
  const seen = new Set(inbound.map((edge) => edge.id));
  const found: CodeEdge[] = [];
  let frontier = aliasIds(inbound);

  for (let depth = 0; depth < ALIAS_DEPTH && frontier.length > 0; depth += 1) {
    const fresh = (await store.findEdges({ project, dstIds: frontier, limit })).filter(
      (edge) => !seen.has(edge.id),
    );
    for (const edge of fresh) seen.add(edge.id);
    found.push(...fresh);
    frontier = aliasIds(fresh);
  }
  return found;
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
  const edgeLimit = Math.max(query.limit * 10, 500);
  const edges = await store.findEdges({
    project,
    ...(ids.length > 0 ? { srcIds: ids, dstIds: ids } : { dstName: query.symbol }),
    limit: edgeLimit,
  });

  const idSet = new Set(ids);
  const pointsAtSymbol = (edge: (typeof edges)[number]): boolean =>
    edge.dstName === query.symbol ||
    edge.dstName.endsWith(`.${query.symbol}`) ||
    (edge.dstId !== '' && idSet.has(edge.dstId));

  const direct = edges.filter(pointsAtSymbol);
  answer.inbound = [...direct, ...(await throughAliases(store, project, direct, edgeLimit))];
  answer.outbound = edges.filter((edge) => idSet.has(edge.srcId) && !pointsAtSymbol(edge));
  answer.empty = answer.definitions.length === 0 && answer.inbound.length === 0;
  if (answer.empty && query.suggest !== false) {
    answer.suggestions = await suggestFor(store, project, query.symbol);
  }
  return answer;
}
