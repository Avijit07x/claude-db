import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR } from '../config/dir.js';

interface Budget {
  day: string;
  used: number;
  pausedUntil: number;
}

export interface BudgetUsage {
  used: number;
  pausedUntil: number;
}

function budgetPath(name: string): string {
  return join(CONFIG_DIR, name, 'budget.json');
}

function today(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function read(name: string, now: number): Budget {
  let saved: Partial<Budget> = {};
  try {
    saved = JSON.parse(readFileSync(budgetPath(name), 'utf8')) as Partial<Budget>;
  } catch {}
  const pausedUntil = Number(saved.pausedUntil) || 0;
  if (saved.day !== today(now)) return { day: today(now), used: 0, pausedUntil };
  return { day: saved.day, used: Number(saved.used) || 0, pausedUntil };
}

function write(name: string, budget: Budget): void {
  mkdirSync(join(CONFIG_DIR, name), { recursive: true });
  writeFileSync(budgetPath(name), `${JSON.stringify(budget)}\n`, 'utf8');
}

export function budgetUsage(name: string, now = Date.now()): BudgetUsage {
  const budget = read(name, now);
  return { used: budget.used, pausedUntil: budget.pausedUntil };
}

export function takeBudget(name: string, limit: number, count: number, now = Date.now()): boolean {
  const budget = read(name, now);
  if (budget.pausedUntil > now || budget.used + count > limit) return false;
  write(name, { ...budget, used: budget.used + count });
  return true;
}

export function pauseBudget(name: string, ms: number, now = Date.now()): void {
  write(name, { ...read(name, now), pausedUntil: now + ms });
}
