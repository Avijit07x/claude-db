import type { CodeEdge, CodeSymbol } from '../../types.js';

const ALIAS_HOPS = 4;

export interface DefinitionGroup {
  definition: CodeSymbol;
  owners: CodeEdge[];
  references: CodeEdge[];
  imports: CodeEdge[];
  reaches: CodeEdge[];
}

export interface GroupedEdges {
  groups: DefinitionGroup[];
  guessed: CodeEdge[];
  unbound: CodeEdge[];
}

function aliasTargets(edges: CodeEdge[]): Map<string, string> {
  const targets = new Map<string, string>();
  for (const edge of edges) {
    if (edge.relation === 'aliases' && edge.srcId && edge.dstId) {
      targets.set(edge.srcId, edge.dstId);
    }
  }
  return targets;
}

function definitionOf(
  id: string,
  defined: ReadonlySet<string>,
  aliases: ReadonlyMap<string, string>,
): string | undefined {
  let current: string | undefined = id;
  for (let hop = 0; current !== undefined && hop <= ALIAS_HOPS; hop += 1) {
    if (defined.has(current)) return current;
    current = aliases.get(current);
  }
  return undefined;
}

function place(group: DefinitionGroup, edge: CodeEdge): void {
  if (edge.relation === 'defines') group.owners.push(edge);
  else if (edge.relation === 'imports') group.imports.push(edge);
  else group.references.push(edge);
}

export function groupByDefinition(
  definitions: CodeSymbol[],
  inbound: CodeEdge[],
  outbound: CodeEdge[],
): GroupedEdges {
  const groups = new Map<string, DefinitionGroup>(
    definitions.map((definition) => [
      definition.id,
      { definition, owners: [], references: [], imports: [], reaches: [] },
    ]),
  );
  const defined = new Set(groups.keys());
  const aliases = aliasTargets(inbound);
  const several = groups.size > 1;
  const guessed: CodeEdge[] = [];
  const unbound: CodeEdge[] = [];

  for (const edge of inbound) {
    const owner = definitionOf(edge.dstId, defined, aliases);
    const group = owner === undefined ? undefined : groups.get(owner);
    if (!group) unbound.push(edge);
    else if (several && edge.confidence === 'INFERRED') guessed.push(edge);
    else place(group, edge);
  }
  for (const edge of outbound) groups.get(edge.srcId)?.reaches.push(edge);
  return { groups: [...groups.values()], guessed, unbound };
}
