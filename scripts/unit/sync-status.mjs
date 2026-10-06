import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../lib/check.mjs';
import { createStore } from '../../dist/store/index.js';

const CLI = new URL('../../dist/cli/index.js', import.meta.url).pathname;

const row = (id, project, status) => ({
  id,
  sessionId: 's',
  project,
  kind: 'context',
  title: `row ${id.slice(0, 4)}`,
  body: 'body',
  files: [],
  tags: [],
  createdAt: Date.now(),
  status,
});

async function seed(path, rows) {
  const store = await createStore(path);
  await store.init();
  await store.insertObservations(rows);
  await store.close();
}

async function statuses(path, ids) {
  const store = await createStore(path);
  await store.init();
  const found = await store.getObservations(ids);
  await store.close();
  return Object.fromEntries(found.map((obs) => [obs.id.slice(0, 4), obs.status]));
}

export default async function run() {
  const dir = mkdtempSync(join(tmpdir(), 'sync-status-'));
  const home = join(dir, 'home');
  const project = join(dir, 'project');
  mkdirSync(home);
  mkdirSync(project);
  const real = realpathSync(project);
  const local = join(dir, 'local.db');
  const remote = join(dir, 'remote.db');
  const cli = (args) =>
    execFileSync(process.execPath, ['--no-warnings', CLI, ...args], {
      cwd: project,
      env: { ...process.env, HOME: home, CLAUDE_DB_URL: local },
      encoding: 'utf8',
    });

  const ids = {
    replacedHere: 'aaaa0000-0000-4000-8000-000000000001',
    closedThere: 'bbbb0000-0000-4000-8000-000000000002',
    openBoth: 'cccc0000-0000-4000-8000-000000000003',
    onlyHere: 'dddd0000-0000-4000-8000-000000000004',
  };

  try {
    await seed(local, [
      row(ids.replacedHere, real, 'replaced'),
      row(ids.closedThere, real, 'open'),
      row(ids.openBoth, real, 'open'),
      row(ids.onlyHere, real, 'done'),
    ]);
    await seed(remote, [
      row(ids.replacedHere, real, 'done'),
      row(ids.closedThere, real, 'done'),
      row(ids.openBoth, real, 'open'),
    ]);

    const dry = cli(['sync', remote]);
    check(
      'a dry run counts the statuses it would move',
      /bring 2 status\(es\) up to date/.test(dry),
      dry.trim(),
    );

    cli(['sync', remote, '--yes']);
    const there = await statuses(remote, Object.values(ids));
    const here = await statuses(local, Object.values(ids));
    check('a row replaced here is replaced there too', there.aaaa === 'replaced');
    check('a row closed there is closed here too', here.bbbb === 'done');
    check('a row open on both sides stays open', here.cccc === 'open' && there.cccc === 'open');
    check('status never moves backwards', here.aaaa === 'replaced');
    check('new rows still travel', there.dddd === 'done');

    const again = cli(['sync', remote]);
    check(
      'a second sync has nothing left to move',
      /bring 0 status\(es\) up to date/.test(again),
      again.trim(),
    );

    const sessions = async (path, act) => {
      const store = await createStore(path);
      await store.init();
      try {
        return await act(store);
      } finally {
        await store.close();
      }
    };
    const chat = (id, summary, updatedAt, extra = {}) => ({
      id,
      project: real,
      startedAt: 1,
      summary,
      updatedAt,
      ...extra,
    });
    await sessions(local, async (store) => {
      await store.upsertSession(chat('newer-here', 'rebuilt summary', 200));
      await store.upsertSession(chat('cleared-there', 'a false claim', 100));
      await store.upsertSession(chat('distilled-here', 'same', 100, { distilledAt: 500 }));
      await store.upsertSession(chat('only-here', 'only here', 100));
    });
    await sessions(remote, async (store) => {
      await store.upsertSession(chat('newer-here', 'old summary', 100));
      await store.upsertSession(chat('cleared-there', 'a false claim', 100));
      await store.clearSummary('cleared-there');
      await store.upsertSession(chat('distilled-here', 'same', 100));
    });

    cli(['sync', remote, '--yes']);
    const remoteChats = await sessions(remote, (store) =>
      Promise.all(['newer-here', 'distilled-here', 'only-here'].map((id) => store.getSession(id))),
    );
    const cleared = await sessions(local, (store) => store.getSession('cleared-there'));
    check('the newer summary wins', remoteChats[0]?.summary === 'rebuilt summary');
    check('and keeps the time it was written', remoteChats[0]?.updatedAt === 200);
    check('a summary cleared on one side is cleared on the other', cleared?.summary === undefined);
    check(
      'a chat already turned into facts is marked so on both sides',
      remoteChats[1]?.distilledAt === 500,
    );
    check('a chat missing on one side is copied', remoteChats[2]?.summary === 'only here');

    const stats = cli(['stats']);
    check(
      'stats counts current memory and reports replaced rows apart',
      /observations: 3\b/.test(stats) && /replaced\s+: 1, kept but left out of search/.test(stats),
      stats.split('\n').slice(1, 3).join(' | '),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
