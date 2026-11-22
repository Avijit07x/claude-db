import type { RecallContext } from '../context.js';
import type { Observation } from '../types.js';
import { openWork } from '../capture/progress.js';
import { FACT_SESSION, factType, onePerKey, youScope } from './model.js';
import { activeRequests } from '../capture/active.js';
import type { ActiveRequest } from '../capture/active.js';
import { handoffBodyLines, handoffHeading, newestHandoff, passedNote } from './handoff.js';
import { latestRequestAt, recentChats, turnLine } from './last-chat.js';
import type { RecentChat } from './last-chat.js';
import { MANUAL_SESSION, factLine, seenByClaude } from './render.js';
import { entry, render, summaryEntry } from './start-render.js';
import type { Entry, Section, StartFacts } from './start-render.js';
import { formatDay, formatDayTime } from '../util/day.js';
import { toShortId } from '../util/shortid.js';

const ABOUT_YOU = 6;
const THIS_PROJECT = 10;
const TODOS = 4;
const UNCOMMITTED = 3;
const CHAT_RULES = 8;

const ORDER = ['rule', 'decision', 'deadend', 'fact'];

export type { StartFacts } from './start-render.js';

export async function startFacts(
  ctx: RecallContext,
  project: string,
  hidden: ReadonlySet<string> = new Set(),
  current?: string,
  earlier: ReadonlySet<string> = new Set(),
): Promise<StartFacts | null> {
  const visible = (obs: Observation) =>
    obs.status !== 'replaced' && !hidden.has(obs.id) && !seenByClaude(obs, project);
  const list = async (owner: string, sessionId: string, limit: number) =>
    (
      await ctx.store.list({ project: owner, sessionId, newest: true, limit, bodies: false })
    ).filter(visible);

  const you = onePerKey(await list(youScope(project), FACT_SESSION, 50));
  const facts = onePerKey(await list(project, FACT_SESSION, 300));
  const handoff = await newestHandoff(ctx, project);
  const shownHandoff = handoff && visible(handoff) ? handoff : null;
  const manual = (await list(project, MANUAL_SESSION, 20)).filter((obs) => obs.id !== handoff?.id);
  const chatRules = await chatRulesFor(ctx, project, [...facts, ...manual], visible);

  const rank = (obs: Observation) => {
    const index = ORDER.indexOf(factType(obs) ?? 'rule');
    return index === -1 ? ORDER.length : index;
  };
  const known = [...manual, ...chatRules, ...facts.filter((obs) => factType(obs) !== 'todo')].sort(
    (a, b) => rank(a) - rank(b) || b.createdAt - a.createdAt,
  );
  const todos = facts.filter((obs) => factType(obs) === 'todo').slice(0, TODOS);
  const uncommitted = (await openWork(ctx.store, project))
    .filter((obs) => !hidden.has(obs.id))
    .slice(0, UNCOMMITTED);
  const recent = await recentWork(ctx, project, current);
  const factEntry = (obs: Observation) => entry(factLine(obs), obs.id, obs.title);

  const sections: Section[] = [
    ['About you:', you.slice(0, ABOUT_YOU).map(factEntry)],
    ['This project:', known.slice(0, THIS_PROJECT).map(factEntry)],
    ...recentSections(recent, hidden),
    [
      shownHandoff
        ? handoffHeading(shownHandoff.createdAt, passedNote(shownHandoff.createdAt, recent.latest))
        : '',
      shownHandoff ? handoffEntries(shownHandoff) : [],
    ],
    [
      'Where you stopped:',
      [
        ...todos.map(factEntry),
        ...uncommitted.map((obs) => entry(`- Not committed: ${obs.title}`, obs.id, obs.title)),
      ],
    ],
  ];

  return render(sections, ctx.config.inject.maxChars, earlier);
}

async function chatRulesFor(
  ctx: RecallContext,
  project: string,
  rulesAndFacts: Observation[],
  visible: (obs: Observation) => boolean,
): Promise<Observation[]> {
  if (rulesAndFacts.some((obs) => obs.kind === 'preference')) return [];
  const rows = await ctx.store.list({
    project,
    kind: 'preference',
    excludeSessions: [FACT_SESSION, MANUAL_SESSION],
    newest: true,
    limit: CHAT_RULES,
    bodies: false,
  });
  return rows.filter(visible);
}

interface RecentWork {
  unfinished: ActiveRequest[];
  chats: RecentChat[];
  latest: number | null;
}

async function recentWork(
  ctx: RecallContext,
  project: string,
  current: string | undefined,
): Promise<RecentWork> {
  const unfinished = activeRequests(await ctx.store.projectScope(project), current);
  const chats = await recentChats(ctx, project, current);
  return { unfinished, chats, latest: latestRequestAt(chats, unfinished) };
}

function recentSections(recent: RecentWork, hidden: ReadonlySet<string>): Section[] {
  return [
    ...recent.unfinished.map(unfinishedSection),
    ...recent.chats.map((chat, index) => chatSection(chat, index, hidden)),
  ];
}

function unfinishedSection(item: ActiveRequest): Section {
  return [
    `Not finished yet in another chat (${formatDayTime(item.askedAt)}):`,
    [entry(`- asked "${item.request}"`, null, item.request)],
  ];
}

function chatSection(chat: RecentChat, index: number, hidden: ReadonlySet<string>): Section {
  const heading = `${index === 0 ? 'Last chat' : 'Chat before'} (${formatDay(chat.at)}):`;
  const turns = chat.turns
    .filter((turn) => !hidden.has(turn.id))
    .map((turn) => entry(`- ${turnLine(turn)} (${toShortId(turn.id)})`, turn.id, turn.title));
  return [heading, chat.summary.length > 0 ? [summaryEntry(chat.summary), ...turns] : turns];
}

function handoffEntries(handoff: Observation): Entry[] {
  return handoffBodyLines(handoff).map((line, index) =>
    index === 0
      ? entry(`${line} (${toShortId(handoff.id)})`, handoff.id, line)
      : entry(line, null, line),
  );
}
