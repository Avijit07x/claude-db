import type { Config } from '../config/index.js';
import type { RecallContext } from '../context.js';
import { renderPicked } from '../hooks/relevance.js';
import type { Observation } from '../types.js';
import { runHeadless } from '../util/claude-cli.js';
import { takeBudget } from '../util/daily-budget.js';
import { PICK_SYSTEM_PROMPT, buildPickPrompt, parsePicks } from './prompt.js';

export const PICK_BUDGET = 'pick';
export const PICK_PAUSE_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 30_000;

export type PickRunner = (prompt: string) => Promise<string | null>;

export type PickOutcome =
  { kind: 'picked'; block: string; ids: string[] } | { kind: 'none' } | { kind: 'failed' };

export interface PickRequest {
  prompt: string;
  previousReply: string;
  ids: string[];
}

export function takePick(config: Config, now = Date.now()): boolean {
  return config.pick.enabled && takeBudget(PICK_BUDGET, config.pick.dailyLimit, 1, now);
}

export function headlessPicker(config: Config): PickRunner {
  return (prompt) =>
    runHeadless(prompt, config.pick.model, TIMEOUT_MS, {
      flags: [['--system-prompt', PICK_SYSTEM_PROMPT], ['--tools', ''], ['--strict-mcp-config']],
      env: { MAX_THINKING_TOKENS: '0' },
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
  const stdout = await run(
    buildPickPrompt({
      prompt: request.prompt,
      previousReply: request.previousReply,
      memories,
      limit,
    }),
  );
  if (stdout === null) return { kind: 'failed' };

  const ids: string[] = [];
  const block = renderPicked(parsePicks(stdout, memories, limit) ?? [], promptMaxChars, ids);
  return block ? { kind: 'picked', block, ids } : { kind: 'none' };
}
