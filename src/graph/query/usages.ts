import { realpathSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import type { MemoryStore } from '../../store/adapter.js';
import { repoRootFor } from '../../usages/find.js';
import { answerQuery } from './answer.js';
import { formatGraph } from './format.js';
import type { GraphAnswer, GraphMode } from './lookup.js';

export interface UsagesRequest {
  store: MemoryStore;
  project: string;
  mode: GraphMode;
  symbol: string;
  target?: string | undefined;
  limit: number;
  path?: string | undefined;
}

function scopeWithin(root: string, path: string): string {
  const scope = relative(realpathSync(root), realpathSync(path));
  if (scope.startsWith('..') || isAbsolute(scope)) {
    throw new Error(`${path} is outside the project ${root}`);
  }
  return scope;
}

const inScope = (scope: string, file: string): boolean =>
  scope === '' || file === scope || file.startsWith(`${scope}/`);

function narrow(answer: GraphAnswer, scope: string): void {
  const keep = (item: { file: string }): boolean => inScope(scope, item.file);
  answer.definitions = answer.definitions.filter(keep);
  answer.inbound = answer.inbound.filter(keep);
  answer.outbound = answer.outbound.filter(keep);
  if (answer.text) answer.text.lines = answer.text.lines.filter(keep);
  answer.empty = answer.definitions.length === 0 && answer.inbound.length === 0;
}

export async function usagesAnswer(request: UsagesRequest): Promise<string> {
  const { store, project, mode, symbol, target, limit, path } = request;
  const root = repoRootFor(project);
  const scope = path && mode !== 'path' ? scopeWithin(root, path) : '';
  const answer = await answerQuery({
    store,
    root,
    project,
    query: { mode, symbol, ...(target ? { target } : {}), limit },
    refresh: true,
  });
  if (scope !== '') narrow(answer, scope);
  return formatGraph(answer, join(root, scope));
}
