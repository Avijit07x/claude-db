import type { Observation } from '../types.js';
import { formatDay } from '../util/day.js';
import { toShortId } from '../util/shortid.js';
import { CLAUDE_MEMORY_TAG, factLabel, machineTag, originTag } from './model.js';

export const MANUAL_SESSION = 'manual';

export function seenByClaude(obs: Observation, project: string): boolean {
  return (
    obs.tags.includes(CLAUDE_MEMORY_TAG) &&
    obs.tags.includes(machineTag()) &&
    obs.tags.includes(originTag(project))
  );
}

export function factLine(obs: Observation, now = Date.now()): string {
  const label = factLabel(obs) ?? 'Fact';
  return `- ${label} (${formatDay(obs.createdAt, now)}): ${obs.title} (${toShortId(obs.id)})`;
}
