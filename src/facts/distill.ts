import type { RecallContext } from '../context.js';
import type { Observation } from '../types.js';
import { embedObservations } from '../capture/flush.js';
import { runHeadless } from '../util/claude-cli.js';
import { formatDay } from '../util/day.js';
import { pauseDistill, takeDistillCalls } from './budget.js';
import { FACT_SESSION, factId, factKey, factToObservation, factType, youScope } from './model.js';
import type { ExistingFact, SetOp } from './ops.js';
import { buildDistillPrompt, parseOps } from './ops.js';

export const FACTS_JOB = 'facts';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_CHARS = 40_000;
const MAX_WINDOWS = 6;
const ROW_CHARS = 900;
const SEPARATOR = '\n\n---\n\n';
const EXISTING_LIMIT = 80;
const SESSION_ROWS = 1000;
const TIMEOUT_MS = 120_000;

export type Runner = (prompt: string, model: string, timeoutMs: number) => Promise<string | null>;

export type DistillOutcome = 'distilled' | 'empty' | 'over-budget' | 'failed';

export interface DistillResult {
  outcome: DistillOutcome;
  set: number;
  retired: number;
}

export interface BackfillResult {
  distilled: number;
  remaining: number;
  stopped: 'done' | 'over-budget' | 'failed';
}

export async function distillSession(
  ctx: RecallContext,
  project: string,
  sessionId: string,
  run: Runner = runHeadless,
): Promise<DistillResult> {
  const rows = (await ctx.store.list({ project, sessionId, limit: SESSION_ROWS })).filter(
    (obs) => obs.status !== 'replaced',
  );
  const last = rows[rows.length - 1];
  if (!last) {
    await markDistilled(ctx, project, sessionId, Date.now());
    return { outcome: 'empty', set: 0, retired: 0 };
  }
  const most = Math.max(1, Math.min(MAX_WINDOWS, ctx.config.distill.dailyLimit));
  const windows = chatWindows(rows, most);
  if (!takeDistillCalls(ctx.config.distill.dailyLimit, windows.length)) {
    return { outcome: 'over-budget', set: 0, retired: 0 };
  }

  const source = `From a chat on ${formatDay(last.createdAt)} (${sessionId.slice(0, 8)}).`;
  let set = 0;
  let retired = 0;
  let summary: string[] = [];
  for (const window of windows) {
    const applied = await distillWindow(ctx, project, window, source, last.createdAt, run);
    if (!applied) {
      pauseDistill();
      return { outcome: 'failed', set, retired };
    }
    set += applied.set;
    retired += applied.retired;
    if (applied.texts.length > 0) summary = applied.texts;
  }

  const startedAt = rows[0]?.createdAt ?? last.createdAt;
  await markDistilled(ctx, project, sessionId, startedAt, summary.slice(0, 3).join(' | '));
  return { outcome: 'distilled', set, retired };
}

async function distillWindow(
  ctx: RecallContext,
  project: string,
  chat: string,
  source: string,
  at: number,
  run: Runner,
): Promise<{ set: number; retired: number; texts: string[] } | null> {
  const existing = await existingFacts(ctx, project);
  const stdout = await run(
    buildDistillPrompt(chat, existing),
    ctx.config.distill.model,
    TIMEOUT_MS,
  );
  if (stdout === null) return null;

  const ops = parseOps(stdout);
  const sets = ops
    .filter((op): op is SetOp => op.op === 'set')
    .map((op): SetOp => (op.type === 'rule' ? op : { ...op, scope: 'project' }));
  const facts = sets.map((op) => factToObservation({ ...op, at, source }, project));
  await embedObservations(ctx, facts);
  await ctx.store.insertObservations(facts);

  const kept = new Set(sets.map((op) => op.key));
  const retiring = ops
    .filter((op) => op.op === 'retire' && !kept.has(op.key))
    .flatMap((op) => existing.filter((fact) => fact.key === op.key))
    .map((fact) => factId(fact.scope === 'you' ? youScope() : project, fact.key));
  const retired = await ctx.store.markReplaced(retiring);
  return { set: facts.length, retired, texts: sets.map((op) => op.text) };
}

export async function pendingSessions(
  ctx: RecallContext,
  project: string,
  now = Date.now(),
): Promise<string[]> {
  const cutoff = now - ctx.config.distill.backfillDays * DAY_MS;
  return (await ctx.store.recentSessions(project, 1000))
    .filter((session) => session.distilledAt === undefined && session.startedAt >= cutoff)
    .map((session) => session.id);
}

export async function backfill(
  ctx: RecallContext,
  project: string,
  run: Runner = runHeadless,
): Promise<BackfillResult> {
  const pending = await pendingSessions(ctx, project);
  let distilled = 0;
  for (const [index, sessionId] of pending.entries()) {
    const result = await distillSession(ctx, project, sessionId, run);
    if (result.outcome === 'over-budget' || result.outcome === 'failed') {
      return { distilled, remaining: pending.length - index, stopped: result.outcome };
    }
    distilled += 1;
  }
  return { distilled, remaining: 0, stopped: 'done' };
}

export async function existingFacts(ctx: RecallContext, project: string): Promise<ExistingFact[]> {
  const owners: [string, ExistingFact['scope']][] = [
    [project, 'project'],
    [youScope(), 'you'],
  ];
  const facts: ExistingFact[] = [];
  for (const [owner, scope] of owners) {
    const rows = await ctx.store.list({
      project: owner,
      sessionId: FACT_SESSION,
      newest: true,
      limit: EXISTING_LIMIT,
    });
    for (const obs of rows) {
      const key = factKey(obs);
      const type = factType(obs);
      if (obs.status === 'replaced' || !key || !type) continue;
      facts.push({ key, type, scope, text: obs.title });
    }
  }
  return facts;
}

export function chatWindows(rows: Observation[], most = MAX_WINDOWS): string[] {
  const windows: string[][] = [];
  let current: string[] = [];
  let used = 0;
  for (const obs of rows) {
    const entry = clip(obs.body, ROW_CHARS);
    if (current.length > 0 && used + entry.length > WINDOW_CHARS) {
      windows.push(current);
      current = [];
      used = 0;
    }
    current.push(entry);
    used += entry.length + SEPARATOR.length;
  }
  if (current.length > 0) windows.push(current);
  return windows.slice(-most).map((window) => window.join(SEPARATOR));
}

async function markDistilled(
  ctx: RecallContext,
  project: string,
  sessionId: string,
  startedAt: number,
  summary = '',
): Promise<void> {
  await ctx.store.upsertSession({
    id: sessionId,
    project,
    startedAt,
    distilledAt: Date.now(),
    ...(summary ? { summary } : {}),
  });
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

export async function factCounts(
  ctx: RecallContext,
  project: string,
): Promise<{ project: number; you: number }> {
  const count = async (owner: string) =>
    (await ctx.store.list({ project: owner, sessionId: FACT_SESSION, limit: 100_000 })).filter(
      (obs) => obs.status !== 'replaced',
    ).length;
  return { project: await count(project), you: await count(youScope()) };
}
