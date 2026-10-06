import type { BudgetUsage } from '../util/daily-budget.js';
import { budgetUsage, pauseBudget, takeBudget } from '../util/daily-budget.js';

const BUDGET = 'distill';
const PAUSE_MS = 24 * 60 * 60 * 1000;

export function distillUsage(now = Date.now()): BudgetUsage {
  return budgetUsage(BUDGET, now);
}

export function takeDistillCalls(limit: number, count: number, now = Date.now()): boolean {
  return takeBudget(BUDGET, limit, count, now);
}

export function pauseDistill(now = Date.now()): void {
  pauseBudget(BUDGET, PAUSE_MS, now);
}
