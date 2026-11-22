import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../lib/check.mjs';
import { newRepo } from '../lib/repo.mjs';
import { createStore } from '../../dist/store/index.js';
import { createScopeResolver } from '../../dist/store/project-resolver.js';
import { withProjectScope } from '../../dist/store/scoped-store.js';
import { closeLandedWork, openWork } from '../../dist/capture/index.js';

async function otherClonesStayOpen() {
  const remote = 'https://github.com/acme/shop.git';
  const clones = ['a', 'b'].map((name) => {
    const { repo, git } = newRepo(`progress-clone-${name}-`);
    git('remote', 'add', 'origin', remote);
    writeFileSync(join(repo, 'f.ts'), 'export const f = 1;\n');
    git('add', '-A');
    git('commit', '-qm', 'seed');
    return repo;
  });
  const [repoA, repoB] = clones;

  const dir = mkdtempSync(join(tmpdir(), 'progress-scope-'));
  const raw = await createStore(join(dir, 'memory.db'));
  await raw.init();
  const store = withProjectScope(raw, createScopeResolver({ store: raw, remote: 'origin' }));

  const row = (id, project) => ({
    id,
    sessionId: 's1',
    project,
    kind: 'decision',
    title: id,
    body: id,
    files: [join(project, 'f.ts')],
    tags: [],
    createdAt: Date.now(),
    status: 'open',
  });
  await store.insertObservations([row('in-a', repoA), row('in-b', repoB)]);
  check(
    'both clones see each other through the shared project',
    (await openWork(store, repoA)).length === 2,
    (await openWork(store, repoA)).length,
  );

  const closed = await closeLandedWork(store, repoA);
  const stillOpen = (await openWork(store, repoA)).map((o) => o.id);
  check(
    'a flush in one clone closes its own landed work and leaves the other clone open',
    closed === 1 && stillOpen.join() === 'in-b',
    `${closed} closed, open: ${stillOpen.join()}`,
  );

  await raw.close();
  rmSync(dir, { recursive: true, force: true });
  for (const repo of clones) rmSync(repo, { recursive: true, force: true });
}

export default async function run() {
  await otherClonesStayOpen();
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
