import '../../lib/require-isolated.mjs';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { report } from '../../lib/isolated.mjs';
import {
  budgetUsage,
  describePause,
  pauseFor,
  recordFailure,
  recordSuccess,
  takeBudget,
} from '../../../dist/util/daily-budget.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = Date.UTC(2026, 9, 6, 12, 0, 0);
const root = join(homedir(), '.claude-memory');

const fresh = budgetUsage('trial', at);
report(
  'a new budget has used nothing, failed nothing and is not paused',
  fresh.used === 0 && fresh.pausedUntil === 0 && fresh.failures === 0 && fresh.lastFailure === null,
);

report('calls are counted', takeBudget('trial', 5, 2, at) && budgetUsage('trial', at).used === 2);

recordFailure('trial', 'exited with code 1: not logged in', at);
const one = budgetUsage('trial', at);
report(
  'the first failure pauses for an hour and keeps the reason and the count',
  one.failures === 1 &&
    one.pausedUntil === at + HOUR &&
    one.lastFailure?.reason === 'exited with code 1: not logged in' &&
    one.used === 2,
  JSON.stringify(one),
);
report(
  'nothing is taken while paused, and calls resume when the pause ends',
  !takeBudget('trial', 5, 1, at + HOUR - 1) && takeBudget('trial', 5, 1, at + HOUR),
);

recordFailure('trial', 'timed out after 30 s', at + HOUR);
report(
  'the second failure in a row pauses for six hours',
  budgetUsage('trial', at + HOUR).pausedUntil === at + 7 * HOUR &&
    budgetUsage('trial', at + HOUR).failures === 2,
);
recordFailure('trial', 'timed out after 30 s', at + 7 * HOUR);
recordFailure('trial', 'timed out after 30 s', at + 8 * DAY);
const capped = budgetUsage('trial', at + 8 * DAY);
report(
  'the third and later failures pause for a day, never longer',
  capped.failures === 4 && capped.pausedUntil === at + 9 * DAY,
  JSON.stringify(capped),
);
report(
  'the schedule is one hour, six hours, then a day',
  [0, 1, 2, 3, 9].map(pauseFor).join() === [HOUR, HOUR, 6 * HOUR, DAY, DAY].join(),
);

report(
  'a day later the call count starts again but the failure streak stays',
  budgetUsage('trial', at + 10 * DAY).used === 0 &&
    budgetUsage('trial', at + 10 * DAY).failures === 4,
);

const described = describePause(capped, at + 8 * DAY);
report(
  'the pause is described with its count and reason',
  described?.includes('4 failed calls in a row') && described.endsWith('timed out after 30 s'),
  described ?? 'not paused',
);
report(
  'a pause that has ended is not described',
  describePause(capped, capped.pausedUntil) === null,
);

recordSuccess('trial', at + 9 * DAY);
const healed = budgetUsage('trial', at + 9 * DAY);
report(
  'a working call clears the streak and the reason',
  healed.failures === 0 && healed.lastFailure === null,
  JSON.stringify(healed),
);

recordFailure('long', `first line\n  second   line ${'x'.repeat(400)}`, at);
const reason = budgetUsage('long', at).lastFailure?.reason ?? '';
report(
  'a stored reason is one short line',
  !reason.includes('\n') && reason.length <= 160 && reason.startsWith('first line second line'),
  reason.length.toString(),
);

mkdirSync(join(root, 'legacy'), { recursive: true });
writeFileSync(
  join(root, 'legacy', 'budget.json'),
  JSON.stringify({ day: '2026-10-06', used: 3, pausedUntil: at + HOUR }),
);
const legacy = budgetUsage('legacy', at);
report(
  'a file from before failures were tracked still reads, as a pause with no reason',
  legacy.used === 3 &&
    legacy.failures === 0 &&
    describePause(legacy, at) !== null &&
    !describePause(legacy, at)?.includes(': '),
  describePause(legacy, at) ?? 'not paused',
);

mkdirSync(join(root, 'broken'), { recursive: true });
writeFileSync(join(root, 'broken', 'budget.json'), 'not json');
report(
  'a damaged file reads as an empty budget',
  budgetUsage('broken', at).used === 0 && budgetUsage('broken', at).failures === 0,
);

report(
  'saving leaves no temporary files behind',
  readdirSync(join(root, 'trial')).join() === 'budget.json',
  readdirSync(join(root, 'trial')).join(),
);
