import type { RecallContext } from '../context.js';
import type { Observation, Session } from '../types.js';
import { GIT_SESSION } from '../capture/git.js';
import { askedIn } from '../capture/turn-extractor.js';
import { toSnippet } from '../util/snippet.js';
import { FACT_SESSION } from './model.js';
import { MANUAL_SESSION } from './render.js';

const NOT_CHATS = [FACT_SESSION, MANUAL_SESSION, GIT_SESSION];
const ROWS_READ = 10;
const TURNS_SHOWN = 5;
const SUMMARY_CHARS = 300;
const SUMMARY_PARTS = ' | ';

export interface RecentChat {
  sessionId: string;
  at: number;
  summary: string | null;
  turns: Observation[];
}

export async function recentChats(
  ctx: RecallContext,
  project: string,
  current?: string,
): Promise<RecentChat[]> {
  const rows = (
    await ctx.store.list({
      project,
      excludeSessions: current ? [...NOT_CHATS, current] : NOT_CHATS,
      newest: true,
      limit: ROWS_READ,
    })
  )
    .filter((row) => row.status !== 'replaced')
    .slice(0, TURNS_SHOWN);

  const byChat = new Map<string, Observation[]>();
  for (const row of rows) byChat.set(row.sessionId, [...(byChat.get(row.sessionId) ?? []), row]);

  return Promise.all(
    [...byChat].map(async ([sessionId, newestFirst]) =>
      toChat(sessionId, newestFirst, await ctx.store.getSession(sessionId)),
    ),
  );
}

function toChat(
  sessionId: string,
  newestFirst: Observation[],
  session: Session | null,
): RecentChat {
  const turns = [...newestFirst].reverse();
  const at = newestFirst[0]?.createdAt ?? 0;
  return { sessionId, at, summary: chatSummary(session, at, turns), turns };
}

function chatSummary(session: Session | null, at: number, turns: Observation[]): string | null {
  if (!session?.summary || session.endedAt === undefined || session.endedAt < at) return null;
  const shown = new Set(turns.map((turn) => turn.title));
  if (session.summary.split(SUMMARY_PARTS).every((part) => shown.has(part))) return null;
  return toSnippet(session.summary, SUMMARY_CHARS) ?? null;
}

export function latestRequestAt(
  chats: RecentChat[],
  unfinished: { askedAt: number }[],
): number | null {
  const times = [...chats.map((chat) => chat.at), ...unfinished.map((entry) => entry.askedAt)];
  return times.length === 0 ? null : Math.max(...times);
}

export function turnLine(turn: Observation): string {
  const asked = askedIn(turn.body);
  return asked ? `asked "${asked}": ${turn.title}` : turn.title;
}
