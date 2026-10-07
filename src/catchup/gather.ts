import type { RecallContext } from '../context.js';
import { openWork } from '../capture/progress.js';
import { FACT_SESSION, factLabel, factType, onePerKey } from '../facts/model.js';
import { handoffBodyLines, newestHandoff } from '../facts/handoff.js';
import type { GitState } from './git-state.js';
import { readGitState } from './git-state.js';

const CHAT_TITLES = 6;
const TODOS = 5;
const UNCOMMITTED = 5;
const DECISIONS = 5;
const FACTS_SCANNED = 100;

export interface CatchupData {
  handoff: { at: number; lines: string[] } | null;
  lastChat: { at: number; summary: string; work: string[] } | null;
  todos: string[];
  decisions: string[];
  uncommitted: string[];
  git: GitState | null;
}

export async function gatherCatchup(
  ctx: RecallContext,
  project: string,
  now = Date.now(),
): Promise<CatchupData> {
  const handoff = await newestHandoff(ctx, project, now);
  const [latest] = await ctx.store.recentSessions(project, 1);

  const chatWork = latest
    ? (await ctx.store.list({ project, sessionId: latest.id, newest: true, limit: CHAT_TITLES }))
        .filter((obs) => obs.status !== 'replaced')
        .map((obs) => obs.title)
    : [];

  const facts = await ctx.store.list({
    project,
    sessionId: FACT_SESSION,
    newest: true,
    limit: FACTS_SCANNED,
  });
  const current = onePerKey(facts.filter((obs) => obs.status !== 'replaced'));
  const todos = current
    .filter((obs) => factType(obs) === 'todo')
    .slice(0, TODOS)
    .map((obs) => obs.title);
  const decisions = current
    .filter((obs) => ['decision', 'deadend'].includes(factType(obs) ?? ''))
    .slice(0, DECISIONS)
    .map((obs) => `${factLabel(obs)}: ${obs.title}`);

  const uncommitted = (await openWork(ctx.store, project))
    .slice(0, UNCOMMITTED)
    .map((obs) => obs.title);

  return {
    handoff: handoff ? { at: handoff.createdAt, lines: handoffBodyLines(handoff) } : null,
    lastChat: latest
      ? { at: latest.startedAt, summary: latest.summary ?? '', work: chatWork }
      : null,
    todos,
    decisions,
    uncommitted,
    git: readGitState(project),
  };
}
