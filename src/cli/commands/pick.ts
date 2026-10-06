import type { Config } from '../../config/index.js';
import { loadConfig, setConfigValue } from '../../config/index.js';
import { PICK_BUDGET } from '../../pick/run.js';
import { budgetUsage } from '../../util/daily-budget.js';

export function pickStatus(config: Config, now = Date.now()): string {
  const { pick } = config;
  if (!pick.enabled) {
    return 'pick     : off, prompts get memory only on a strong word match (claude-db pick on)';
  }
  const usage = budgetUsage(PICK_BUDGET, now);
  const paused =
    usage.pausedUntil > now
      ? `, paused until ${new Date(usage.pausedUntil).toISOString()} after a failed call`
      : '';
  return `pick     : on (${pick.model}), ${usage.used} of ${pick.dailyLimit} picks used today${paused}`;
}

export function cmdPick(argv: (string | undefined)[]): void {
  const [first] = argv;
  if (first === 'on' || first === 'off') {
    setConfigValue('pick', 'enabled', first === 'on');
    console.log(
      first === 'on'
        ? 'Haiku will pick the memory shown with each prompt, up to the daily limit.'
        : 'Haiku picking is off. Prompts get memory only on a strong word match; nothing calls Claude.',
    );
    return;
  }
  console.log(pickStatus(loadConfig()));
}
