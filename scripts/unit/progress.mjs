import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../lib/check.mjs';
import { newRepo } from '../lib/repo.mjs';
import { createStore } from '../../dist/store/index.js';
import { closeLandedWork, openWork } from '../../dist/capture/index.js';

export default async function run() {
  const { repo, git } = newRepo('progress-');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(repo, 'src', 'b.ts'), 'export const b = 1;\n');
  git('add', '-A');
  git('commit', '-qm', 'seed');

  const dir = mkdtempSync(join(tmpdir(), 'progress-db-'));
  const store = await createStore(join(dir, 'memory.db'));
  await store.init();

  const obs = (id, title, files, status) => ({
    id,
    sessionId: 's1',
    project: repo,
    kind: 'decision',
    title,
    body: title,
    files,
    tags: [],
    createdAt: Date.now() - (id === 'o1' ? 2000 : 1000),
    status,
  });

  writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 2;\n');

  await store.insertObservations([
    obs('o1', 'edited a, not committed', [join(repo, 'src', 'a.ts')], 'open'),
    obs('o2', 'edited b, already committed', [join(repo, 'src', 'b.ts')], 'open'),
  ]);

  let open = await openWork(store, repo);
  check('freshly captured work starts open', open.length === 2, open.length);

  const closed = await closeLandedWork(store, repo);
  check('work whose files are committed gets closed', closed === 1, closed);

  open = await openWork(store, repo);
  check('only the uncommitted work stays open', open.length === 1, open.length);
  check('and it is the right one', open[0]?.title.includes('not committed'), open[0]?.title);

  check(
    'open work is newest first, so a resume reads top-down',
    open.every((o, i) => i === 0 || o.createdAt <= open[i - 1].createdAt),
  );

  git('add', '-A');
  git('commit', '-qm', 'land it');
  const closedAfter = await closeLandedWork(store, repo);
  check('committing the rest closes it too', closedAfter === 1, closedAfter);
  check('nothing is left open', (await openWork(store, repo)).length === 0);

  writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 3;\n');
  await closeLandedWork(store, repo);
  check(
    'closing is one-way: touching the file again does not reopen finished work',
    (await openWork(store, repo)).length === 0,
  );

  await store.insertObservations([{ ...obs('o4', 'ran a command, touched no files', [], 'open') }]);
  await closeLandedWork(store, repo);
  check(
    'a turn that touched no files cannot stay open forever',
    (await openWork(store, repo)).length === 0,
    (await openWork(store, repo)).map((o) => o.title).join(','),
  );

  const [stored] = await store.getObservations(['o1']);
  check('status round-trips through the store', stored?.status === 'done', stored?.status);

  const older = {
    ...obs('o3', 'predates the feature', [join(repo, 'src', 'a.ts')]),
    status: undefined,
  };
  delete older.status;
  await store.insertObservations([older]);
  check(
    'a row written without a status is not treated as open work',
    (await openWork(store, repo)).length === 0,
  );

  await store.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
}
