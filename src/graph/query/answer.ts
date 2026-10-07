import type { MemoryStore } from '../../store/adapter.js';
import type { GraphAnswer, GraphQuery } from './lookup.js';
import { queryGraph } from './lookup.js';
import { refreshGraph } from './refresh.js';
import { unlinkedText } from './text.js';

export const NO_GRAPH =
  'No code graph for this project yet (run `claude-db scan` to build one), so this is a ' +
  'plain text search:';

export const NO_GRAPH_FOR_PATH =
  'No code graph for this project yet. Run `claude-db scan` to build one, then ask for the ' +
  'path again.';

export interface AnswerRequest {
  store: MemoryStore;
  root: string;
  project: string;
  query: GraphQuery;
  refresh: boolean;
  text?: boolean;
}

export function addText(answer: GraphAnswer, root: string): void {
  if (answer.mode === 'path') return;
  answer.text = unlinkedText(root, answer.symbol, answer.definitions, answer.inbound);
}

export const hasGraph = async (store: MemoryStore, project: string): Promise<boolean> =>
  (await store.scannedFiles(project)).length > 0;

export async function answerQuery(request: AnswerRequest): Promise<GraphAnswer> {
  const { store, root, project, query } = request;
  const refreshed = request.refresh ? await refreshGraph(store, root, project) : [];
  const answer = await queryGraph(store, project, query);
  answer.refreshed = refreshed;
  if (request.text !== false) addText(answer, root);
  return answer;
}
