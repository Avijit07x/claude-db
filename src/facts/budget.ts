import { redact } from '../capture/redact.js';
import type { BudgetUsage } from '../util/daily-budget.js';
import { budgetUsage, recordFailure, recordSuccess, takeBudget } from '../util/daily-budget.js';

const BUDGET = 'distill';

export function distillUsage(now = Date.now()): BudgetUsage {
  return budgetUsage(BUDGET, now);
}

export function takeDistillCalls(limit: number, count: number, now = Date.now()): boolean {
  return takeBudget(BUDGET, limit, count, now);
}

export function recordDistillFailure(reason: string, now = Date.now()): void {
  recordFailure(BUDGET, redact(reason), now);
}

export function recordDistillSuccess(now = Date.now()): void {
  recordSuccess(BUDGET, now);
}
