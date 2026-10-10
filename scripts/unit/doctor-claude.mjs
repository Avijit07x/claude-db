import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { check } from '../lib/check.mjs';
import { describeClaude } from '../../dist/cli/commands/doctor.js';
import { waitingWarning, STALE_WAITING_MS } from '../../dist/facts/health.js';
import { findOnPath } from '../../dist/util/claude-binary.js';
import { createStore } from '../../dist/store/index.js';

const CLI = new URL('../../dist/cli/index.js', import.meta.url).pathname;
const DAY = 24 * 60 * 60 * 1000;

const OK_CLAUDE = `#!/usr/bin/env node
process.stdout.write('ok');
`;

const BROKEN_CLAUDE = `#!/usr/bin/env node
process.stderr.write('error: not logged in\\n');
process.exit(1);
`;

function script(dir, name, body) {
  const path = join(dir, name);
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
}

function runOrphaned(dir, args, env) {
  const out = join(dir, 'out.txt');
  const code = join(dir, 'code.txt');
  rmSync(out, { force: true });
  rmSync(code, { force: true });
  const command = `(${JSON.stringify(process.execPath)} --no-warnings ${JSON.stringify(CLI)} ${args} > ${JSON.stringify(out)} 2>&1; echo $? > ${JSON.stringify(code)}) &`;
  spawnSync('/bin/sh', ['-c', command], { cwd: dir, env, stdio: 'ignore' });
  const deadline = Date.now() + 60_000;
  while (!existsSync(code) && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  return {
    status: existsSync(code) ? Number(readFileSync(code, 'utf8').trim()) : -1,
    stdout: existsSync(out) ? readFileSync(out, 'utf8') : '',
  };
}

export default async function run() {
  check(
    'a found binary is shown with its path and where it came from',
    describeClaude({ path: '/opt/claude', source: 'saved path' }) ===
      'claude   : /opt/claude (from saved path)',
  );
  const missing = describeClaude(null);
  check(
    'a missing binary says so and gives one next step',
    missing.includes('NOT FOUND') && missing.includes('put claude on PATH'),
  );

  const now = Date.parse('2026-10-07T12:00:00Z');
  const idle = { used: 0, pausedUntil: 0, failures: 0, lastFailure: null };
  const old = now - STALE_WAITING_MS - 1000;
  const young = now - STALE_WAITING_MS + 60_000;
  check(
    'waiting chats past the limit with nothing tried give a warning',
    waitingWarning(3, old, idle, now)?.startsWith('warning') === true,
  );
  check(
    'the warning names the command that works through the waiting chats',
    waitingWarning(3, old, idle, now)?.includes('claude-db distill --backfill') === true,
    waitingWarning(3, old, idle, now),
  );
  check('waiting chats under the limit give none', waitingWarning(3, young, idle, now) === null);
  check('no waiting chats give none', waitingWarning(0, null, idle, now) === null);
  check(
    'a call tried today means no warning',
    waitingWarning(3, old, { ...idle, used: 2 }, now) === null,
  );
  check(
    'a pause already shows its own reason, so no warning',
    waitingWarning(3, old, { ...idle, pausedUntil: now + DAY / 2 }, now) === null,
  );

  const dir = mkdtempSync(join(tmpdir(), 'doctor-claude-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    check('nothing on an empty PATH is found', findOnPath({ PATH: bin }) === null);
    const onPath = script(bin, 'claude', OK_CLAUDE);
    check('claude on PATH is found', findOnPath({ PATH: `/nowhere:${bin}` }) === onPath);

    const home = join(dir, 'home');
    const work = join(dir, 'work');
    mkdirSync(home);
    mkdirSync(work);
    const base = {
      HOME: home,
      PATH: '',
      CLAUDE_DB_URL: join(dir, 'db.sqlite'),
    };
    const withNode = { ...base, PATH: dirname(process.execPath) };

    const real = realpathSync(work);
    const dbPath = base.CLAUDE_DB_URL;
    const addChat = async (id, startedAt) => {
      const store = await createStore(dbPath);
      await store.init();
      await store.upsertSession({ id, project: real, startedAt, summary: id });
      await store.close();
    };
    const waitingLine = (output) => output.split('\n').find((line) => line.startsWith('waiting'));

    await addChat('young-chat', Date.now());
    const youngStatus = runOrphaned(work, 'status', base);
    check(
      'status shows no warning for a chat that started today',
      youngStatus.stdout.includes('waiting  : 1 chat(s)') &&
        !youngStatus.stdout.includes('warning  :'),
      waitingLine(youngStatus.stdout),
    );

    await addChat('old-chat', Date.now() - 3 * DAY);
    const oldStatus = runOrphaned(work, 'status', base);
    check(
      'status warns about a chat that waited over a day with nothing tried',
      oldStatus.stdout.includes('waiting  : 2 chat(s)') &&
        oldStatus.stdout.includes('warning  : 2 chat(s) have waited over a day'),
      waitingLine(oldStatus.stdout),
    );

    const none = runOrphaned(work, 'doctor', base);
    check(
      'doctor says claude was not found and still exits zero, because it is a warning',
      none.stdout.includes('claude   : NOT FOUND') && none.status === 0,
      `exit ${none.status}`,
    );

    const found = runOrphaned(work, 'doctor', { ...withNode, CLAUDE_CODE_EXECPATH: onPath });
    check(
      'doctor names the variable as the source and exits zero',
      found.stdout.includes(`claude   : ${onPath} (from CLAUDE_CODE_EXECPATH)`) &&
        found.status === 0,
      `exit ${found.status}`,
    );

    const deep = runOrphaned(work, 'doctor --deep', { ...withNode, CLAUDE_CODE_EXECPATH: onPath });
    check(
      'doctor --deep makes the small call and reports it',
      deep.stdout.includes('ok   call — ok') && deep.status === 0,
      `exit ${deep.status}`,
    );

    const broken = script(bin, 'broken-claude', BROKEN_CLAUDE);
    const failed = runOrphaned(work, 'doctor --deep', {
      ...withNode,
      CLAUDE_CODE_EXECPATH: broken,
    });
    check(
      'doctor --deep reports a failed call and exits non-zero',
      failed.stdout.includes('FAIL call — exited with code 1: error: not logged in') &&
        failed.status === 1,
      `exit ${failed.status}`,
    );

    const skipped = runOrphaned(work, 'doctor --deep', base);
    check(
      'doctor --deep without claude fails the call step',
      skipped.stdout.includes('FAIL call — claude was not found') && skipped.status === 1,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
