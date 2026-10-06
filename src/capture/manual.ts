import type { RecallContext } from '../context.js';
import type { Observation, ObservationKind } from '../types.js';
import { embedObservations } from './flush.js';
import { currentAuthor, observationId } from './identity.js';
import { redact } from './redact.js';

export interface RememberInput {
  project: string;
  text: string;
  kind?: ObservationKind;
  files?: string[];
  tags?: string[];
  key?: string;
}

export async function remember(ctx: RecallContext, input: RememberInput): Promise<Observation> {
  const createdAt = Date.now();
  const author = currentAuthor();
  const text = redact(input.text);
  const title = firstLine(text);

  const observation: Observation = {
    id: input.key
      ? observationId('manual', 0, `${input.project}\0${input.key}`)
      : observationId('manual', createdAt, input.text),
    sessionId: 'manual',
    project: input.project,
    kind: input.kind ?? 'preference',
    title,
    body: text,
    files: input.files ?? [],
    tags: [...new Set(['manual', ...(input.tags ?? [])])],
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
