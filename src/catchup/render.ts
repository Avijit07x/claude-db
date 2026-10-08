import { handoffHeading } from '../facts/handoff.js';
import { formatDay, formatDayTime } from '../util/day.js';
import type { CatchupData } from './gather.js';

export const NOTHING_RECORDED = 'Nothing recorded for this project yet.';

function section(heading: string, lines: string[]): string[] {
  return lines.length === 0 ? [] : [heading, ...lines, ''];
}

function bullets(items: string[]): string[] {
  return items.map((item) => `  - ${item}`);
}

function gitLines(data: CatchupData): { status: string[]; commits: string[] } {
  const git = data.git;
  if (!git) return { status: [], commits: [] };
  const hidden = git.hiddenStatusLines > 0 ? [`  ...and ${git.hiddenStatusLines} more`] : [];
  return {
    status: [...git.status.map((line) => `  ${line}`), ...hidden],
    commits: git.commits.map((line) => `  ${line}`),
  };
}

function branchLine(git: CatchupData['git']): string[] {
  if (!git) return [];
  const state =
    git.changed === 0 ? 'clean' : `${git.changed} file${git.changed === 1 ? '' : 's'} uncommitted`;
  return [`Branch: ${git.branch ?? 'detached HEAD'}, ${state}`, ''];
}

function chatBlocks(chats: CatchupData['chats'], now: number): string[] {
  return chats.flatMap((chat, index) => {
    if (!chat.summary && chat.work.length === 0) return [];
    const heading = `${index === 0 ? 'Last chat' : 'Chat before'} (${formatDay(chat.at, now)}):`;
    return [chat.summary ? `${heading} ${chat.summary}` : heading, ...bullets(chat.work), ''];
  });
}

function unfinishedBlocks(unfinished: CatchupData['unfinished'], now: number): string[] {
  return unfinished.flatMap((entry) =>
    section(`Not finished yet in another chat (${formatDayTime(entry.at, now)}):`, [
      `  - asked "${entry.request}"`,
    ]),
  );
}

function handoffBlock(handoff: CatchupData['handoff'], now: number): string[] {
  if (!handoff) return [];
  return section(
    handoffHeading(handoff.at, handoff.passed, now),
    handoff.lines.map((line) => `  ${line}`),
  );
}

export function renderCatchup(data: CatchupData, now = Date.now()): string {
  const { status, commits } = gitLines(data);
  const blocks = [
    ...handoffBlock(data.handoff, now),
    ...unfinishedBlocks(data.unfinished, now),
    ...chatBlocks(data.chats, now),
    ...section('Still to do (from facts):', bullets(data.todos)),
    ...section('Decisions and dead ends (from facts):', bullets(data.decisions)),
    ...section('Not committed yet (recorded work):', bullets(data.uncommitted)),
    ...branchLine(data.git),
    ...section('Git status:', status),
    ...section('Recent commits:', commits),
  ];
  return blocks.length === 0 ? NOTHING_RECORDED : blocks.join('\n').trimEnd();
}
