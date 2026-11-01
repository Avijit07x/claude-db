import { check } from '../lib/check.mjs';
import { createScopeResolver } from '../../dist/store/project-resolver.js';

function fakeStore() {
  const links = [];
  const calls = { link: 0, scope: 0 };
  return {
    calls,
    async linkProject(folder, key) {
      calls.link += 1;
      if (!links.some((l) => l.folder === folder && l.key === key)) links.push({ folder, key });
    },
    async projectScope(folder) {
      calls.scope += 1;
      const keys = links.filter((l) => l.folder === folder).map((l) => l.key);
      const folders = links.filter((l) => keys.includes(l.key)).map((l) => l.folder);
      return [...new Set([...keys, ...folders])];
    },
  };
}

export default async function run() {
  const store = fakeStore();
  let clock = 0;
  const resolver = createScopeResolver({
    store,
    remote: 'origin',
    isFolder: (value) => value.startsWith('/r/'),
    keyOf: (folder) => (folder.startsWith('/r/shop') ? 'github.com/acme/shop' : folder),
    now: () => clock,
  });

  const first = await resolver.resolve('/r/shop-a');
  check(
    'a new folder is linked once and read back with its key',
    store.calls.link === 1 && first.names.includes('github.com/acme/shop'),
    JSON.stringify(store.calls),
  );

  for (let i = 0; i < 5; i += 1) await resolver.resolve('/r/shop-a');
  await resolver.key('/r/shop-a');
  check(
    'later lookups of the same folder ask the database nothing',
    store.calls.link === 1 && store.calls.scope === 2,
    JSON.stringify(store.calls),
  );

  const linkedBefore = createScopeResolver({
    store,
    remote: 'origin',
    isFolder: (value) => value.startsWith('/r/'),
    keyOf: () => 'github.com/acme/shop',
  });
  const before = store.calls.link;
  await linkedBefore.resolve('/r/shop-a');
  check('a folder already linked is not linked again', store.calls.link === before);

  await resolver.resolve('/r/shop-b');
  const again = await resolver.resolve('/r/shop-a');
  check(
    'linking a second clone refreshes the scope of the first',
    again.names.includes('/r/shop-b'),
    again.names.join(),
  );

  const scopeCalls = store.calls.scope;
  clock += 61_000;
  await resolver.resolve('/r/shop-a');
  check('a scope older than a minute is read again', store.calls.scope === scopeCalls + 1);

  const plain = await resolver.resolve('plain-name');
  check(
    'a value that is not a folder is its own scope',
    plain.key === 'plain-name' && plain.names.join() === 'plain-name',
  );
}
