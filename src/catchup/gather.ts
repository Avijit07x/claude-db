import type { RecallContext } from '../context.js';
import { openWork } from '../capture/progress.js';
import { FACT_SESSION, factLabel, factType, onePerKey } from '../facts/model.js';
import { activeRequests } from '../capture/active.js';
import { handoffBodyLines, newestHandoff, passedNote } from '../facts/handoff.js';
import { latestRequestAt, recentChats, turnLine } from '../facts/last-chat.js';
import type { GitState } from './git-state.js';
import { readGitState } from './git-state.js';

const TODOS = 5;
const UNCOMMITTED = 5;
const DECISIONS = 5;
const FACTS_SCANNED = 100;

export interface CatchupData {
  handoff: { at: number; lines: string[]; passed: boolean } | null;
  unfinished: { at: number; request: string }[];
  chats: { at: number; summary: string | null; work: string[] }[];
  todos: string[];
  decisions: string[];
  uncommitted: string[];
  git: GitState | null;
}

export async function gatherCatchup(
  ctx: RecallContext,
  project: string,
  current?: string,
  now = Date.now(),
): Promise<CatchupData> {
  const handoff = await newestHandoff(ctx, project, now);
  const unfinished = activeRequests(await ctx.store.projectScope(project), current, now);
  const chats = await recentChats(ctx, project, current);
  const latest = latestRequestAt(chats, unfinished);

  const facts = await ctx.store.list({
    project,
    sessionId: FACT_SESSION,
    newest: true,
    limit: FACTS_SCANNED,
  });
  const kept = onePerKey(facts.filter((obs) => obs.status !== 'replaced'));
  const todos = kept
    .filter((obs) => factType(obs) === 'todo')
    .slice(0, TODOS)
    .map((obs) => obs.title);
  const decisions = kept
    .filter((obs) => ['decision', 'deadend'].includes(factType(obs) ?? ''))
    .slice(0, DECISIONS)
    .map((obs) => `${factLabel(obs)}: ${obs.title}`);

  const uncommitted = (await openWork(ctx.store, project))
    .slice(0, UNCOMMITTED)
    .map((obs) => obs.title);

  return {
    handoff: handoff
      ? {
          at: handoff.createdAt,
          lines: handoffBodyLines(handoff),
          passed: passedNote(handoff.createdAt, latest),
        }
      : null,
    unfinished: unfinished.map((entry) => ({ at: entry.askedAt, request: entry.request })),
    chats: chats.map((chat) => ({
      at: chat.at,
      summary: chat.summary,
      work: chat.turns.map(turnLine),
    })),
    todos,
    decisions,
    uncommitted,
    git: readGitState(project),
  };
}
