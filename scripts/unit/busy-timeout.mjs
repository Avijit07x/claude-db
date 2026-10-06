import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../lib/check.mjs';
import { createStore } from '../../dist/store/index.js';

const HOLD_MS = 600;

const HOLDER = `
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[1]);
db.exec('BEGIN IMMEDIATE');
process.stdout.write('locked\\n');
setTimeout(() => db.exec('COMMIT'), ${HOLD_MS});
`;

const row = () => ({
  id: randomUUID(),
  sessionId: 's',
  project: '/p',
  kind: 'context',
  title: 'written while another process held the lock',
  body: 'body',
  files: [],
  tags: [],
  createdAt: Date.now(),
  status: 'done',
});

function holdLock(path) {
  const child = spawn(process.execPath, ['--no-warnings', '-e', HOLDER, path], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return {
    locked: new Promise((resolve) => child.stdout.once('data', resolve)),
    released: new Promise((resolve) => child.once('exit', resolve)),
  };
}

export default async function run() {
  const dir = mkdtempSync(join(tmpdir(), 'busy-'));
  try {
    const store = await createStore(join(dir, 'memory.db'));
    await store.init();
    const holder = holdLock(join(dir, 'memory.db'));
    await holder.locked;

    const started = Date.now();
    let failure = null;
    try {
      await store.insertObservations([row()]);
    } catch (error) {
      failure = error;
    }
    const waited = Date.now() - started;
    await holder.released;

    check(
      'a write waits for another process that holds the lock, then succeeds',
      failure === null,
      failure?.message,
    );
    check('it waited until the lock was released', waited >= HOLD_MS - 200, `${waited} ms`);
    check('and the row was saved', (await store.list({ project: '/p', limit: 5 })).length === 1);
    await store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
