import { randomUUID } from 'node:crypto';
import { createScopeResolver } from '../../dist/store/project-resolver.js';
import { withProjectScope } from '../../dist/store/scoped-store.js';

const sameIds = (rows, expected) =>
  rows
    .map((row) => row.id)
    .sort()
    .join() === [...expected].sort().join();

export default async function run({ store: raw }, check) {
  const tag = randomUUID().replace(/\D/g, '').slice(0, 8);
  const term = `heron${tag}`;
  const F1 = `/scoped/${tag}/one`;
  const F2 = `/scoped/${tag}/two`;
  const F3 = `/scoped/${tag}/three`;
  const BARE = `/scoped/${tag}/bare`;
  const PLAIN = `plain-${tag}`;
  const KEY = `github.com/acme/shop-${tag}`;
  const KEY3 = `github.com/acme/other-${tag}`;
  const MOVED = `github.com/acme/moved-${tag}`;

  const open = (keys) =>
    withProjectScope(
      raw,
      createScopeResolver({
        store: raw,
        remote: 'origin',
        isFolder: (value) => value.startsWith('/scoped/'),
        keyOf: (folder) => keys[folder] ?? folder,
      }),
    );
  const keys = { [F1]: KEY, [F2]: KEY, [F3]: KEY3 };
  const store = open(keys);

  const row = (project, label) => ({
    id: randomUUID(),
    sessionId: `s-${tag}-${label}`,
    project,
    kind: 'context',
    title: `${label} row`,
    body: `${term} in the ${label} row`,
    files: [],
    tags: [],
    createdAt: Date.now(),
  });
  const old = row(F1, 'old');
  await raw.insertObservations([old]);

  const fromTwo = row(F2, 'two');
  await store.insertObservations([fromTwo]);
  const other = row(F3, 'three');
  await store.insertObservations([other]);
  const bare = row(BARE, 'bare');
  const plain = row(PLAIN, 'plain');
  await store.insertObservations([bare, plain]);

  const storedUnder = async (project) => (await raw.list({ project, limit: 100 })).map((r) => r.id);
  check(
    'a write from a folder with a remote is saved under the key',
    (await storedUnder(KEY)).includes(fromTwo.id) && !(await storedUnder(F2)).includes(fromTwo.id),
  );
  check(
    'a folder with no remote and a name that is not a folder are saved as they are',
    (await storedUnder(BARE)).includes(bare.id) && (await storedUnder(PLAIN)).includes(plain.id),
  );
  check(
    'a row saved before the change, under the folder, is still where it was',
    (await storedUnder(F1)).includes(old.id),
  );

  check(
    'the first clone reads its old row and the row the second clone wrote',
    sameIds(await store.list({ project: F1, limit: 100 }), [old.id, fromTwo.id]),
  );
  check(
    'the second clone reads the same two rows',
    sameIds(await store.list({ project: F2, limit: 100 }), [old.id, fromTwo.id]),
  );
  const hits = (await store.searchKeyword({ text: term, project: F2, limit: 50 })).map((h) => h.id);
  check(
    'search from the second clone finds the first clone old row',
    hits.includes(old.id) && hits.includes(fromTwo.id) && !hits.includes(other.id),
  );
  check(
    'a different repository sees neither',
    sameIds(await store.list({ project: F3, limit: 100 }), [other.id]),
  );
  check(
    'a folder with no remote sees only itself',
    sameIds(await store.list({ project: BARE, limit: 100 }), [bare.id]),
  );

  await store.upsertSession({
    id: `sess-${tag}`,
    project: F2,
    startedAt: Date.now(),
    summary: 'x',
  });
  check(
    'a chat saved from one clone shows up for the other',
    (await store.recentSessions(F1, 10)).some((s) => s.id === `sess-${tag}`),
  );

  const afterMove = open({ ...keys, [F1]: MOVED });
  const moved = row(F1, 'moved');
  await afterMove.insertObservations([moved]);
  check(
    'after the remote moves, the folder reads the old rows, the shared rows and the new one',
    sameIds(await afterMove.list({ project: F1, limit: 100 }), [old.id, fromTwo.id, moved.id]),
  );
  check(
    'and the clone that did not move still reads what it did before',
    sameIds(await store.list({ project: F2, limit: 100 }), [old.id, fromTwo.id, moved.id]) ||
      sameIds(await store.list({ project: F2, limit: 100 }), [old.id, fromTwo.id]),
  );

  check(
    'ping, kind and reading by id still work through the wrapper',
    (await store.ping()) &&
      store.kind === raw.kind &&
      (await store.getObservations([old.id])).length === 1,
  );

  const removed = await store.remove({ project: F2 });
  check(
    'removing for a folder removes the rows of its scope and nothing else',
    removed === 2 &&
      sameIds(await afterMove.list({ project: F1, limit: 100 }), [moved.id]) &&
      sameIds(await store.list({ project: F3, limit: 100 }), [other.id]),
    String(removed),
  );

  await afterMove.remove({ project: F1 });
  await store.remove({ project: F3 });
  await store.remove({ project: BARE });
  await store.remove({ project: PLAIN });
}
