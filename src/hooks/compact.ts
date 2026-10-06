import { flushSession } from '../capture/index.js';
import type { RecallContext } from '../context.js';
import type { Observation, ObservationKind } from '../types.js';
import { toShortId } from '../util/shortid.js';
import { capturingDisabled } from './payload.js';
import { forgetShown } from './shown.js';

const MAX_LINES = 8;
const SCANNED = 200;

const LABELS: Partial<Record<ObservationKind, string>> = {
  decision: 'Decided',
  deadend: 'Dead end',
  preference: 'Rule',
};

export interface EarlierInChat {
  block: string;
  ids: ReadonlySet<string>;
}

export async function recoverAfterCompact(
  ctx: RecallContext,
  project: string,
  sessionId: string,
  transcriptPath: string | undefined,
): Promise<EarlierInChat | null> {
  forgetShown(sessionId);
  if (!capturingDisabled(ctx.config.capture.scripted)) {
    await flushSession(ctx, sessionId, project, transcriptPath);
  }
  const observations = await ctx.store.list({ project, sessionId, newest: true, limit: SCANNED });
  return renderEarlierInChat(observations);
}

export function renderEarlierInChat(newestFirst: Observation[]): EarlierInChat | null {
  const lines: string[] = [];
  const ids = new Set<string>();
  const titles = new Set<string>();

  for (const obs of newestFirst) {
    const label = LABELS[obs.kind] ?? (obs.status === 'open' ? 'Not committed' : null);
    if (!label || obs.status === 'replaced') continue;
    if (titles.has(obs.title)) {
      ids.add(obs.id);
      continue;
    }
    titles.add(obs.title);
    ids.add(obs.id);
    lines.push(`- ${label}: ${obs.title} (${toShortId(obs.id)})`);
    if (lines.length === MAX_LINES) break;
  }

  if (lines.length === 0) return null;
  const block = ['<memory>', 'Earlier in this chat:', ...lines.reverse(), '</memory>'].join('\n');
  return { block, ids };
}
