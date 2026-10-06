import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CONFIG_DIR } from '../config/dir.js';

const HOUR_MS = 60 * 60 * 1000;
const REASON_CHARS = 160;

export const BACKOFF_MS: readonly number[] = [HOUR_MS, 6 * HOUR_MS, 24 * HOUR_MS];

export interface BudgetFailure {
  at: number;
  reason: string;
}

export interface BudgetUsage {
  used: number;
  pausedUntil: number;
  failures: number;
  lastFailure: BudgetFailure | null;
}

interface Budget extends BudgetUsage {
  day: string;
}

function budgetPath(name: string): string {
  return join(CONFIG_DIR, name, 'budget.json');
}

function today(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function readFailure(value: unknown): BudgetFailure | null {
  if (typeof value !== 'object' || value === null) return null;
  const { at, reason } = value as Partial<BudgetFailure>;
  return typeof at === 'number' && typeof reason === 'string' ? { at, reason } : null;
}

function read(name: string, now: number): Budget {
  let saved: Partial<Record<keyof Budget, unknown>> = {};
  try {
    saved = JSON.parse(readFileSync(budgetPath(name), 'utf8')) as typeof saved;
  } catch {}
  return {
    day: today(now),
    used: saved.day === today(now) ? Number(saved.used) || 0 : 0,
    pausedUntil: Number(saved.pausedUntil) || 0,
    failures: Number(saved.failures) || 0,
    lastFailure: readFailure(saved.lastFailure),
  };
}

function write(name: string, budget: Budget): void {
  const path = budgetPath(name);
  mkdirSync(dirname(path), { recursive: true });
  const staging = `${path}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify(budget)}\n`, 'utf8');
  renameSync(staging, path);
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, REASON_CHARS);
}

export function pauseFor(failures: number): number {
  const step = Math.min(Math.max(failures, 1), BACKOFF_MS.length);
  return BACKOFF_MS[step - 1] ?? HOUR_MS;
}

export function budgetUsage(name: string, now = Date.now()): BudgetUsage {
  const { used, pausedUntil, failures, lastFailure } = read(name, now);
  return { used, pausedUntil, failures, lastFailure };
}

export function takeBudget(name: string, limit: number, count: number, now = Date.now()): boolean {
  const budget = read(name, now);
  if (budget.pausedUntil > now || budget.used + count > limit) return false;
  write(name, { ...budget, used: budget.used + count });
  return true;
}

export function recordFailure(name: string, reason: string, now = Date.now()): void {
  const budget = read(name, now);
  const failures = budget.failures + 1;
  write(name, {
    ...budget,
    failures,
    pausedUntil: now + pauseFor(failures),
    lastFailure: { at: now, reason: oneLine(reason) },
  });
}

export function recordSuccess(name: string, now = Date.now()): void {
  const budget = read(name, now);
  if (budget.failures === 0 && budget.lastFailure === null) return;
  write(name, { ...budget, failures: 0, lastFailure: null });
}

export function describePause(usage: BudgetUsage, now = Date.now()): string | null {
  if (usage.pausedUntil <= now) return null;
  const until = new Date(usage.pausedUntil).toISOString();
  const after = usage.failures > 1 ? `${usage.failures} failed calls in a row` : 'a failed call';
  const reason = usage.lastFailure ? `: ${usage.lastFailure.reason}` : '';
  return `until ${until} after ${after}${reason}`;
}
