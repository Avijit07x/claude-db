import type { RecallContext } from '../context.js';
import type { Observation } from '../types.js';
import { MANUAL_SESSION } from './render.js';

export const HANDOFF_TAG = 'handoff';
export const HANDOFF_KEY = 'handoff';

const DAY_MS = 24 * 60 * 60 * 1000;
const HANDOFF_MAX_AGE_MS = 14 * DAY_MS;
const MANUAL_NOTES_SCANNED = 50;
const HANDOFF_MAX_LINES = 8;
const HANDOFF_LINE_CHARS = 220;

export async function newestHandoff(
  ctx: RecallContext,
  project: string,
  now = Date.now(),
): Promise<Observation | null> {
  const notes = await ctx.store.list({
    project,
    sessionId: MANUAL_SESSION,
    newest: true,
    limit: MANUAL_NOTES_SCANNED,
  });
  const current = (obs: Observation): boolean =>
    obs.status !== 'replaced' &&
    obs.tags.includes(HANDOFF_TAG) &&
    now - obs.createdAt <= HANDOFF_MAX_AGE_MS;
  return notes.find(current) ?? null;
}

function clipLine(line: string): string {
  return line.length > HANDOFF_LINE_CHARS
    ? `${line.slice(0, HANDOFF_LINE_CHARS - 1).trimEnd()}…`
    : line;
}

export function handoffBodyLines(obs: Observation): string[] {
  const lines = obs.body
    .split('\n')
    .slice(1)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  const shown = lines.slice(0, HANDOFF_MAX_LINES).map(clipLine);
  const hidden = lines.length - shown.length;
  return hidden > 0 ? [...shown, `- ...${hidden} more line(s) in the full note`] : shown;
}
