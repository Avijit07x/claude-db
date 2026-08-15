import type { RecallContext } from '../context.js';
import type { Observation, ObservationKind } from '../types.js';
import { embedObservations } from './flush.js';
import { currentAuthor, observationId } from './identity.js';

export interface RememberInput {
  project: string;
  text: string;
  kind?: ObservationKind;
  files?: string[];
}

/**
 * Records something the user stated outright, rather than something inferred
 * from a transcript.
 *
 * Everything else in this package derives memory from what happened. That
 * cannot capture a rule, because a rule is not an event: "we always use pnpm
 * here" leaves no edit and no command, so the extractor correctly drops it and
 * the one thing worth remembering forever is the one thing never stored.
 *
 * Written through the same shape as captured observations, so it is searched,
 * ranked, injected, exported and pruned identically.
 */
export async function remember(
  ctx: RecallContext,
  input: RememberInput,
): Promise<Observation> {
  const createdAt = Date.now();
  const author = currentAuthor();
  const title = firstLine(input.text);

  const observation: Observation = {
    id: observationId('manual', createdAt, input.text),
    sessionId: 'manual',
    project: input.project,
    kind: input.kind ?? 'preference',
    title,
    body: input.text,
    files: input.files ?? [],
    tags: ['manual'],
    createdAt,
    ...(author ? { author } : {}),
  };

  await embedObservations(ctx, [observation]);
  await ctx.store.insertObservations([observation]);
  return observation;
}

const TITLE_MAX = 80;

function firstLine(text: string): string {
  const line = text.trim().split('\n')[0]?.trim() ?? '';
  const clipped = line.length <= TITLE_MAX ? line : `${line.slice(0, TITLE_MAX)}...`;
  return clipped.length > 0 ? clipped : 'Note';
}
