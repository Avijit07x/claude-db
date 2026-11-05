import '../../lib/require-isolated.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { report } from '../../lib/isolated.mjs';
import { withFlushLock } from '../../../dist/capture/flush-lock.js';

const cursors = join(homedir(), '.claude-memory', 'cursors');
mkdirSync(cursors, { recursive: true });
const lockModule = new URL('../../../dist/capture/flush-lock.js', import.meta.url).href;
const DEAD_PID = '999999999';

const worker = (sessionId, log, startAt) => `
  import { appendFileSync } from 'node:fs';
  import { withFlushLock } from ${JSON.stringify(lockModule)};
  while (Date.now() < ${startAt});
  await withFlushLock(${JSON.stringify(sessionId)}, async () => {
    appendFileSync(${JSON.stringify(log)}, 'start\\n');
    await new Promise((settle) => setTimeout(settle, 150));
    appendFileSync(${JSON.stringify(log)}, 'end\\n');
  }, { waitMs: 3000, onTimeout: 'skip' });
`;

const runWorker = (source) =>
  new Promise((settle) => {
    spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: 'ignore' }).on(
      'exit',
      settle,
    );
  });

let overlapped = 0;
const ROUNDS = 6;
for (let round = 0; round < ROUNDS; round += 1) {
  const sessionId = `race-${round}`;
  const log = join(homedir(), `${sessionId}.log`);
  rmSync(log, { force: true });
  writeFileSync(join(cursors, `${sessionId}.lock`), DEAD_PID);
  const startAt = Date.now() + 400;
  await Promise.all([1, 2, 3].map(() => runWorker(worker(sessionId, log, startAt))));
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  let depth = 0;
  let worst = 0;
  for (const line of lines) {
    depth += line === 'start' ? 1 : -1;
    worst = Math.max(worst, depth);
  }
  if (worst > 1 || lines.length !== 6) overlapped += 1;
}
report(
  'three processes that all find a dead lock never flush at the same time',
  overlapped === 0,
  `${overlapped} of ${ROUNDS} rounds overlapped`,
);

const busy = join(cursors, 'busy.lock');
const other = `${process.pid} someone-else`;
writeFileSync(busy, other);
let ran = false;
const skipped = await withFlushLock(
  'busy',
  async () => {
    ran = true;
  },
  { waitMs: 200, onTimeout: 'skip' },
);
report('a timed-out wait that is told to skip does not run the work', !skipped.ran && !ran);

const forced = await withFlushLock('busy', async () => 'saved', { waitMs: 200, onTimeout: 'run' });
report(
  'a timed-out wait that is told to run still runs, and leaves the holder lock alone',
  forced.ran && forced.value === 'saved' && readFileSync(busy, 'utf8') === other,
);
rmSync(busy, { force: true });

const own = await withFlushLock('free', async () => existsSync(join(cursors, 'free.lock')));
report(
  'a free lock is held during the work and removed after it',
  own.ran && own.value === true && !existsSync(join(cursors, 'free.lock')),
);
