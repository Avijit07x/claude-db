import type { RecallContext } from '../context.js';
import type { Observation } from '../types.js';
import { openWork } from '../capture/progress.js';
import { FACT_SESSION, factType, onePerKey, youScope } from './model.js';
import { newestHandoff, handoffBodyLines } from './handoff.js';
import { MANUAL_SESSION, factLine, seenByClaude } from './render.js';
import { formatDay } from '../util/day.js';
import { toShortId } from '../util/shortid.js';

const ABOUT_YOU = 6;
const THIS_PROJECT = 10;
const TODOS = 4;
const UNCOMMITTED = 3;

const ORDER = ['rule', 'decision', 'deadend', 'fact'];

export interface StartFacts {
  block: string;
  ids: Set<string>;
}

export async function startFacts(
  ctx: RecallContext,
  project: string,
  hidden: ReadonlySet<string> = new Set(),
): Promise<StartFacts | null> {
  const visible = (obs: Observation) =>
    obs.status !== 'replaced' && !hidden.has(obs.id) && !seenByClaude(obs, project);
  const list = async (owner: string, sessionId: string, limit: number) =>
    (await ctx.store.list({ project: owner, sessionId, newest: true, limit })).filter(visible);

  const you = onePerKey(await list(youScope(), FACT_SESSION, 50));
  const facts = onePerKey(await list(project, FACT_SESSION, 300));
  const handoff = await newestHandoff(ctx, project);
  const shownHandoff = handoff && visible(handoff) ? handoff : null;
  const manual = (await list(project, MANUAL_SESSION, 20)).filter((obs) => obs.id !== handoff?.id);
  if (you.length + facts.length + manual.length === 0 && !shownHandoff) return null;

  const rank = (obs: Observation) => {
    const index = ORDER.indexOf(factType(obs) ?? 'rule');
    return index === -1 ? ORDER.length : index;
  };
  const known = [...manual, ...facts.filter((obs) => factType(obs) !== 'todo')].sort(
    (a, b) => rank(a) - rank(b) || b.createdAt - a.createdAt,
  );
  const todos = facts.filter((obs) => factType(obs) === 'todo').slice(0, TODOS);
  const uncommitted = (await openWork(ctx.store, project))
    .filter((obs) => !hidden.has(obs.id))
    .slice(0, UNCOMMITTED);

  const sections: [string, [string, string | null][]][] = [
    ['About you:', you.slice(0, ABOUT_YOU).map((obs) => [factLine(obs), obs.id])],
    ['This project:', known.slice(0, THIS_PROJECT).map((obs) => [factLine(obs), obs.id])],
    [
      shownHandoff ? `Last handoff (${formatDay(shownHandoff.createdAt)}):` : '',
      shownHandoff ? handoffEntries(shownHandoff) : [],
    ],
    [
      'Where you stopped:',
      [
        ...todos.map((obs): [string, string] => [factLine(obs), obs.id]),
        ...uncommitted.map((obs): [string, null] => [`- Not committed: ${obs.title}`, null]),
      ],
    ],
  ];

  const lines = ['<memory>'];
  const ids = new Set<string>();
  let budget = ctx.config.inject.maxChars;
  for (const [heading, entries] of sections) {
    if (entries.length === 0) continue;
    if (lines.length > 1) lines.push('');
    lines.push(heading);
    for (const [line, id] of entries) {
      if (line.length > budget) break;
      budget -= line.length + 1;
      lines.push(line);
      if (id) ids.add(id);
    }
  }
  lines.push('</memory>');
  return { block: lines.join('\n'), ids };
}

function handoffEntries(handoff: Observation): [string, string | null][] {
  return handoffBodyLines(handoff).map((line, index) => [
    index === 0 ? `${line} (${toShortId(handoff.id)})` : line,
    index === 0 ? handoff.id : null,
  ]);
}
