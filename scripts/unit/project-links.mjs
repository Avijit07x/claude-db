import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { check } from '../lib/check.mjs';
import { createStore } from '../../dist/store/index.js';
import { isLinkable, noProjects, orderScope, projectsOf } from '../../dist/store/project-scope.js';

const KEY = 'github.com/acme/shop';
const OTHER_KEY = 'github.com/acme/shop-api';
const sameSet = (actual, expected) =>
  actual.length === expected.length && expected.every((value) => actual.includes(value));

export default async function run() {
  check(
    'a folder and a key can be linked, and a folder with no remote cannot',
    isLinkable('/a/shop', KEY) &&
      !isLinkable('/a/shop', '/a/shop') &&
      !isLinkable('', KEY) &&
      !isLinkable('/a/shop', '  '),
  );
  check(
    'a scope starts with the folder, then the rest sorted without repeats',
    orderScope('/b', ['/z', '/a', '/b', '/a']).join() === '/b,/a,/z',
  );

  check(
    'a project filter is one name or a list, without repeats or empty names',
    projectsOf(undefined).length === 0 &&
      projectsOf('/a').join() === '/a' &&
      projectsOf(['/a', '/b', '/a', '']).join() === '/a,/b' &&
      projectsOf('').length === 0,
  );
  check(
    'only an explicit empty list means nothing, and a missing filter or a name does not',
    noProjects([]) &&
      noProjects(['']) &&
      !noProjects(undefined) &&
      !noProjects('') &&
      !noProjects('/a') &&
      !noProjects(['/a']),
  );

  const dir = mkdtempSync(join(tmpdir(), 'project-links-'));
  const path = join(dir, 'memory.db');
  try {
    const store = await createStore(path);
    await store.init();

    check(
      'a folder that was never linked has a scope of itself',
      sameSet(await store.projectScope('/laptop/shop'), ['/laptop/shop']),
    );

    await store.linkProject('/laptop/shop', KEY, 1000);
    check(
      'a linked folder finds its key',
      sameSet(await store.projectScope('/laptop/shop'), ['/laptop/shop', KEY]),
    );
    check(
      'and the scope lists the folder first',
      (await store.projectScope('/laptop/shop'))[0] === '/laptop/shop',
    );

    await store.linkProject('/mac/work/shop', KEY, 2000);
    check(
      'a second clone of the same repository joins the scope of the first',
      sameSet(await store.projectScope('/laptop/shop'), ['/laptop/shop', '/mac/work/shop', KEY]),
    );
    check(
      'and the first joins the scope of the second',
      sameSet(await store.projectScope('/mac/work/shop'), ['/mac/work/shop', '/laptop/shop', KEY]),
    );

    await store.linkProject('/laptop/shop', KEY, 9999);
    const raw = new DatabaseSync(path);
    const links = raw.prepare('SELECT folder, project_key, first_seen FROM project_links').all();
    raw.close();
    check(
      'linking twice keeps one row and the first time it was seen',
      links.length === 2 && links.find((row) => row.folder === '/laptop/shop')?.first_seen === 1000,
      JSON.stringify(links),
    );

    await store.linkProject('/other/api', OTHER_KEY, 3000);
    check(
      'a different repository stays out of the scope',
      !(await store.projectScope('/laptop/shop')).includes('/other/api') &&
        !(await store.projectScope('/laptop/shop')).includes(OTHER_KEY) &&
        sameSet(await store.projectScope('/other/api'), ['/other/api', OTHER_KEY]),
    );

    await store.linkProject('/laptop/shop', 'github.com/acme/renamed', 4000);
    await store.linkProject('/third/renamed', 'github.com/acme/renamed', 5000);
    const moved = await store.projectScope('/laptop/shop');
    check(
      'when the remote moves, the old and the new key are both in the scope',
      moved.includes(KEY) && moved.includes('github.com/acme/renamed'),
      moved.join(' | '),
    );
    check(
      'a clone that only knows the old key does not reach the new one',
      !(await store.projectScope('/mac/work/shop')).includes('github.com/acme/renamed') &&
        !(await store.projectScope('/third/renamed')).includes(KEY),
    );

    await store.linkProject('/no/remote', '/no/remote', 6000);
    await store.linkProject('', KEY, 6000);
    await store.linkProject('/blank/key', '   ', 6000);
    check(
      'a folder with no remote, a blank folder and a blank key are not stored',
      sameSet(await store.projectScope('/no/remote'), ['/no/remote']) &&
        sameSet(await store.projectScope('/blank/key'), ['/blank/key']),
    );

    const awkward = `/odd/it's "shop"; DROP TABLE project_links;--`;
    await store.linkProject(awkward, KEY, 7000);
    check(
      'quotes and SQL in a name are stored as plain text',
      sameSet(await store.projectScope(awkward), [
        awkward,
        '/laptop/shop',
        '/mac/work/shop',
        KEY,
      ]) && (await store.projectScope('/laptop/shop')).includes(awkward),
    );

    await store.close();
    const again = await createStore(path);
    await again.init();
    await again.init();
    check(
      'the map survives closing and opening, and init can run again',
      (await again.projectScope('/mac/work/shop')).includes('/laptop/shop'),
    );
    await again.close();

    const old = new DatabaseSync(path);
    old.exec('DROP TABLE project_links');
    old.close();
    const upgraded = await createStore(path);
    await upgraded.init();
    await upgraded.linkProject('/fresh', KEY, 8000);
    check(
      'a database made before the map existed gets the table on init',
      sameSet(await upgraded.projectScope('/fresh'), ['/fresh', KEY]),
    );
    await upgraded.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
