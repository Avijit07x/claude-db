import type { MemoryStore } from '../../store/adapter.js';
import type { CodeEdge } from '../../types.js';

const MAX_EDGES = 20000;
const MAX_ENDPOINTS = 5000;
const UNRESOLVED = 'name:';

interface Side {
  parent: Map<string, string | null>;
  depth: Map<string, number>;
  frontier: string[];
}

const nodeFor = (id: string, name: string): string => (id ? id : `${UNRESOLVED}${name}`);

function sideFrom(nodes: string[]): Side {
  return {
    parent: new Map(nodes.map((node) => [node, null])),
    depth: new Map(nodes.map((node) => [node, 0])),
    frontier: nodes,
  };
}

async function endpoints(store: MemoryStore, project: string, name: string): Promise<string[]> {
  const symbols = await store.findSymbols({ project, name, limit: MAX_ENDPOINTS });
  return [...new Set(symbols.map((symbol) => symbol.id)), `${UNRESOLVED}${name}`];
}

function edgesOf(
  store: MemoryStore,
  project: string,
  frontier: string[],
  forward: boolean,
  limit: number,
): Promise<CodeEdge[]> {
  const ids = frontier.filter((node) => !node.startsWith(UNRESOLVED));
  const names = frontier
    .filter((node) => node.startsWith(UNRESOLVED))
    .map((node) => node.slice(UNRESOLVED.length));
  return store.findEdges(
    forward
      ? { project, srcIds: ids, unresolvedSrcNames: names, limit }
      : { project, dstIds: ids, unresolvedDstNames: names, limit },
  );
}

function chain(side: Side, from: string): string[] {
  const nodes: string[] = [];
  for (let node: string | null | undefined = from; node; node = side.parent.get(node)) {
    nodes.push(node);
  }
  return nodes;
}

export async function shortestPath(
  store: MemoryStore,
  project: string,
  from: string,
  to: string,
): Promise<string[]> {
  if (!from || !to) return [];
  if (from === to) return [from];

  const label = new Map<string, string>();
  const ahead = sideFrom(await endpoints(store, project, from));
  const behind = sideFrom(await endpoints(store, project, to));
  for (const node of ahead.frontier) label.set(node, from);
  for (const node of behind.frontier) label.set(node, to);

  let spent = 0;
  while (ahead.frontier.length > 0 && behind.frontier.length > 0) {
    const forward = ahead.frontier.length <= behind.frontier.length;
    const [mine, other] = forward ? [ahead, behind] : [behind, ahead];
    const current = new Set(mine.frontier);

    const edges = await edgesOf(store, project, mine.frontier, forward, MAX_EDGES - spent + 1);
    spent += edges.length;
    if (spent > MAX_EDGES) return [];

    const next: string[] = [];
    let meet: string | null = null;
    for (const edge of edges) {
      const src = nodeFor(edge.srcId, edge.srcName);
      const dst = nodeFor(edge.dstId, edge.dstName);
      if (src === dst) continue;
      if (!label.has(src)) label.set(src, edge.srcName);
      const [near, far] = forward ? [src, dst] : [dst, src];
      if (!current.has(near) || mine.parent.has(far)) continue;
      mine.parent.set(far, near);
      mine.depth.set(far, (mine.depth.get(near) ?? 0) + 1);
      next.push(far);
      const reached = other.depth.get(far);
      if (reached !== undefined && (meet === null || reached < (other.depth.get(meet) ?? 0))) {
        meet = far;
      }
    }

    if (meet !== null) {
      const nodes = [...chain(ahead, meet).reverse(), ...chain(behind, meet).slice(1)];
      return nodes.map((node) => label.get(node) ?? node.replace(/^name:/, ''));
    }
    mine.frontier = next;
  }
  return [];
}
