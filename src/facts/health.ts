import type { BudgetUsage } from '../util/daily-budget.js';

export const STALE_WAITING_MS = 24 * 60 * 60 * 1000;

export function waitingWarning(
  waiting: number,
  oldestAt: number | null,
  usage: BudgetUsage,
  now = Date.now(),
): string | null {
  if (waiting === 0 || oldestAt === null) return null;
  if (now - oldestAt < STALE_WAITING_MS) return null;
  if (usage.used > 0 || usage.pausedUntil > now) return null;
  return `warning  : ${waiting} chat(s) have waited over a day and no facts were tried today. Run claude-db doctor`;
}
