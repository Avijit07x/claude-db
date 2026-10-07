import type { Config } from '../config/index.js';
import { redact } from '../capture/redact.js';
import type { RecallContext } from '../context.js';
import { renderPicked } from '../hooks/relevance.js';
import type { Observation } from '../types.js';
import type { HeadlessResult } from '../util/claude-cli.js';
import { runHeadlessResult } from '../util/claude-cli.js';
import { recordFailure, recordSuccess, takeBudget } from '../util/daily-budget.js';
import { PICK_SYSTEM_PROMPT, buildPickPrompt, parsePicks } from './prompt.js';

export const PICK_BUDGET = 'pick';
const TIMEOUT_MS = 30_000;
const LATEST_HAIKU = 'claude-haiku-5-5';

export type PickRunner = (prompt: string) => Promise<HeadlessResult>;

export type PickOutcome =
  | { kind: 'picked'; block: string; ids: string[] }
  | { kind: 'none' }
  | { kind: 'failed'; reason: string };

export interface PickRequest {
  prompt: string;
  previousReply: string;
  ids: string[];
}

export function takePick(config: Config, now = Date.now()): boolean {
  return config.pick.enabled && takeBudget(PICK_BUDGET, config.pick.dailyLimit, 1, now);
}

export function recordPickFailure(reason: string, now = Date.now()): void {
  recordFailure(PICK_BUDGET, redact(reason), now);
}

export function recordPickSuccess(now = Date.now()): void {
  recordSuccess(PICK_BUDGET, now);
}

interface PickModel {
  model: string;
  fallback?: string;
}

export function pickModel(config: Config): PickModel {
  const { model } = config.pick;
  return model === 'haiku' ? { model: LATEST_HAIKU, fallback: model } : { model };
}

export function headlessPicker(config: Config): PickRunner {
  const { model, fallback } = pickModel(config);
  return (prompt) =>
    runHeadlessResult(prompt, model, TIMEOUT_MS, {
      flags: [['--system-prompt', PICK_SYSTEM_PROMPT], ['--tools', ''], ['--strict-mcp-config']],
      env: { MAX_THINKING_TOKENS: '0' },
      ...(fallback ? { fallbackModel: fallback } : {}),
    });
}

export async function pickMemories(
  ctx: RecallContext,
  request: PickRequest,
  run: PickRunner,
): Promise<PickOutcome> {
  const found = new Map(
    (await ctx.search.getObservations(request.ids)).map((memory) => [memory.id, memory]),
  );
  const memories = request.ids
    .map((id) => found.get(id))
    .filter((memory): memory is Observation => memory !== undefined);
  if (memories.length === 0) return { kind: 'none' };

  const { promptResults: limit, promptMaxChars } = ctx.config.inject;
  const reply = await run(
    buildPickPrompt({
      prompt: request.prompt,
      previousReply: request.previousReply,
      memories,
      limit,
    }),
  );
  if (!reply.ok) return { kind: 'failed', reason: reply.reason };

  const ids: string[] = [];
  const block = renderPicked(parsePicks(reply.stdout, memories, limit) ?? [], promptMaxChars, ids);
  return block ? { kind: 'picked', block, ids } : { kind: 'none' };
}
