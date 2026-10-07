import { randomUUID } from 'node:crypto';

const sameSet = (actual, expected) =>
  actual.length === expected.length && expected.every((value) => actual.includes(value));

export default async function run({ store }, check) {
  const id = randomUUID().slice(0, 8);
  const key = `github.com/acme/shop-${id}`;
  const apiKey = `github.com/acme/api-${id}`;
  const laptop = `/laptop/${id}/shop`;
  const mac = `/mac/${id}/work/shop`;
  const api = `/other/${id}/api`;

  check(
    'the map table is claude-db own, not a foreign one',
    !(await store.inventory()).includes('project_links'),
  );
  check(
    'an unlinked folder has a scope of itself',
    sameSet(await store.projectScope(laptop), [laptop]),
  );

  await store.linkProject(laptop, key, 1000);
  check(
    'a linked folder finds its key, folder first',
    sameSet(await store.projectScope(laptop), [laptop, key]) &&
      (await store.projectScope(laptop))[0] === laptop,
  );

  await store.linkProject(mac, key, 2000);
  check(
    'a second clone of the repository shares the scope both ways',
    sameSet(await store.projectScope(laptop), [laptop, mac, key]) &&
      sameSet(await store.projectScope(mac), [mac, laptop, key]),
  );

  await Promise.all(Array.from({ length: 6 }, () => store.linkProject(laptop, key, 9000)));
  check(
    'linking the same pair many times at once leaves one link',
    sameSet(await store.projectScope(laptop), [laptop, mac, key]),
  );

  await store.linkProject(api, apiKey, 3000);
  check(
    'a different repository stays out of the scope',
    !(await store.projectScope(laptop)).includes(api) &&
      !(await store.projectScope(laptop)).includes(apiKey) &&
      sameSet(await store.projectScope(api), [api, apiKey]),
  );

  const renamed = `github.com/acme/renamed-${id}`;
  await store.linkProject(laptop, renamed, 4000);
  const moved = await store.projectScope(laptop);
  check(
    'when the remote moves, the old and the new key are both in the scope',
    moved.includes(key) && moved.includes(renamed),
    moved.join(' | '),
  );
  check(
    'a clone that knows only the old key does not reach the new one',
    !(await store.projectScope(mac)).includes(renamed),
  );

  const bare = `/no/remote/${id}`;
  await store.linkProject(bare, bare, 5000);
  await store.linkProject('', key, 5000);
  await store.linkProject(`/blank/${id}`, '   ', 5000);
  check(
    'a folder with no remote, a blank folder and a blank key are not stored',
    sameSet(await store.projectScope(bare), [bare]) &&
      sameSet(await store.projectScope(`/blank/${id}`), [`/blank/${id}`]) &&
      !(await store.projectScope(laptop)).includes(''),
  );

  const awkward = `/odd/${id}/it's "shop"; DROP TABLE project_links;--`;
  await store.linkProject(awkward, key, 6000);
  check(
    'quotes and SQL text in a name are plain text',
    (await store.projectScope(awkward)).includes(laptop) &&
      (await store.projectScope(laptop)).includes(awkward),
  );

  const unicode = `/données/${id}/日本語 shop`;
  await store.linkProject(unicode, key, 7000);
  check('non-ASCII names round trip', (await store.projectScope(laptop)).includes(unicode));
}
