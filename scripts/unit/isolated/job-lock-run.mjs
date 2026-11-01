import '../../lib/require-isolated.mjs';
import { existsSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { report } from '../../lib/isolated.mjs';
import { claimJob, keepJob, releaseJob } from '../../../dist/util/job-lock.js';
import { scopeToken } from '../../../dist/util/scope.js';

const JOB = 'trial-job';
const lockOf = (key) => join(homedir(), '.claude-memory', JOB, `${scopeToken(key)}.lock`);
const ageBy = (path, ms) => {
  const at = new Date(Date.now() - ms);
  utimesSync(path, at, at);
};

report('a free job can be claimed', claimJob(JOB, 'a'));
report('a held job cannot be claimed again', !claimJob(JOB, 'a'));

ageBy(lockOf('a'), 11 * 60_000);
report('a lock older than ten minutes is taken over', claimJob(JOB, 'a'));
report(
  'and the lock it left is fresh, so a second claimer gets nothing',
  !claimJob(JOB, 'a') && !existsSync(`${lockOf('a')}.break`),
);

claimJob(JOB, 'b');
ageBy(lockOf('b'), 11 * 60_000);
writeFileSync(`${lockOf('b')}.break`, String(Date.now()));
report('a stale lock that another process is breaking is left alone', !claimJob(JOB, 'b'));

ageBy(`${lockOf('b')}.break`, 60_000);
report('a breaker left by a dead process is cleared after half a minute', claimJob(JOB, 'b'));

releaseJob(JOB, 'a');
report('a released job can be claimed again', claimJob(JOB, 'a'));

const stop = keepJob(JOB, 'a');
stop();
report('keeping a job alive can be stopped and does not hold the process open', true);
