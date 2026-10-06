import type { RecallContext } from '../context.js';
import { FACT_SESSION } from '../facts/model.js';
import type { ObservationIndexEntry } from '../types.js';
import { isSearchable, typedPrompt } from '../util/prompt.js';
import { clearsOverlap, renderPromptContext } from './relevance.js';

export const PICK_POOL = 10;
const STRICT_OVERLAP = 4;

export interface PromptRecallRequest {
  prompt: string;
  project: string;
  sessionId: string;
  shown: ReadonlySet<string>;
  until?: number;
}

export interface PromptCandidates {
  prompt: string;
  entries: ObservationIndexEntry[];
}

export interface PromptRecall {
  block: string;
  ids: string[];
}

export async function promptCandidates(
  ctx: RecallContext,
  request: PromptRecallRequest,
): Promise<PromptCandidates | null> {
  const { inject } = ctx.config;
  const prompt = typedPrompt(request.prompt);
  if (!inject.perPrompt || prompt === null || !isSearchable(prompt)) return null;

  const found = await ctx.search.search({
    text: prompt,
    project: request.project,
    excludeSessions: [request.sessionId, FACT_SESSION],
    limit: PICK_POOL,
    ...(request.until !== undefined ? { until: request.until } : {}),
  });

  const entries = found.filter((entry) => !request.shown.has(entry.id));
  if (!entries.some((entry) => clearsOverlap(prompt, entry, inject.minOverlap))) return null;
  return { prompt, entries };
}

export async function strictRecall(
  ctx: RecallContext,
  candidates: PromptCandidates,
): Promise<PromptRecall | null> {
  const { inject } = ctx.config;
  const [top] = candidates.entries;
  const floor = Math.max(inject.minOverlap, STRICT_OVERLAP);
  if (!top || !clearsOverlap(candidates.prompt, top, floor)) return null;

  const expanded = inject.expandTop > 0 ? await ctx.search.getObservations([top.id]) : [];
  const ids: string[] = [];
  const block = renderPromptContext(
    [top],
    inject.promptMaxChars,
    expanded,
    inject.expandMaxChars,
    ids,
  );
  return block ? { block, ids } : null;
}

export function withCost(block: string): string {
  return `${block}\n(context ≈ ${Math.round(block.length / 4)} tokens)\n`;
}
