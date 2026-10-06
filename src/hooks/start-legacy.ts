import type { RecallContext } from '../context.js';
import { openWork } from '../capture/index.js';
import { toShortId } from '../util/shortid.js';

export interface LegacyBlock {
  text: string;
  hasMemory: boolean;
}

export async function legacyBlock(
  ctx: RecallContext,
  project: string,
  restored: ReadonlySet<string>,
): Promise<LegacyBlock> {
  const sessions = await ctx.store.recentSessions(project, ctx.config.inject.sessions);
  if (sessions.length === 0) {
    return {
      text: '<project-memory>none yet for this project; it is recorded as you work</project-memory>',
      hasMemory: false,
    };
  }

  const lines = ['<project-memory>'];
  let budget = ctx.config.inject.maxChars;

  for (const session of sessions) {
    const when = new Date(session.startedAt).toISOString().slice(0, 10);
    const line = `- [${when}] ${session.summary ?? ''}`;
    if (line.length > budget) break;
    budget -= line.length;
    lines.push(line);
  }

  const open = (await openWork(ctx.store, project)).filter((obs) => !restored.has(obs.id));
  if (open.length > 0) {
    lines.push('', 'Not committed yet, newest first:');
    for (const obs of open.slice(0, 3)) lines.push(`- ${obs.title}`);
  }

  const rules = (await ctx.store.list({ project, kind: 'preference', limit: 100, newest: true }))
    .filter((obs) => obs.status !== 'replaced' && !restored.has(obs.id))
    .sort((a, b) => {
      const manual = Number(b.sessionId === 'manual') - Number(a.sessionId === 'manual');
      return manual !== 0 ? manual : b.createdAt - a.createdAt;
    })
    .slice(0, 8);
  if (rules.length > 0) {
    lines.push('', 'Standing rules on record — expand any id with get_observations:');
    for (const obs of rules) {
      const when = new Date(obs.createdAt).toISOString().slice(0, 10);
      const line = `- ${toShortId(obs.id)} [${when}] ${obs.title}`.slice(0, 140);
      if (line.length > budget) break;
      budget -= line.length;
      lines.push(line);
    }
  }

  lines.push('</project-memory>');
  return { text: lines.join('\n'), hasMemory: true };
}
