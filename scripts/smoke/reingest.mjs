import { randomUUID } from 'node:crypto';

export default async function run(
  { store, search, project, now, sessionId, expected, uri },
  check,
) {
  const revised = {
    id: randomUUID(),
    sessionId,
    project,
    kind: 'context',
    files: [],
    tags: [],
    createdAt: now,
  };
  await store.insertObservations([
    { ...revised, title: 'Zerplix cache warmer drafted', body: 'first pass' },
  ]);
  await store.insertObservations([
    { ...revised, title: 'Quorbit cache warmer finished', body: 'second pass' },
  ]);

  const orphanSql = `SELECT count(*) AS n FROM observations_fts WHERE observations_fts MATCH '"zerplix"'`;
  let orphans = null;
  if (expected === 'sqlite') {
    const { DatabaseSync } = await import('node:sqlite');
    const raw = new DatabaseSync(uri);
    orphans = raw.prepare(orphanSql).get().n;
    raw.close();
  }
  if (expected === 'libsql') {
    orphans = Number((await store.client.execute({ sql: orphanSql, args: [] })).rows[0].n);
  }
  if (orphans !== null) {
    check(
      're-ingest leaves no orphan rows in the fts index',
      orphans === 0,
      `${orphans} orphan posting(s)`,
    );
  }

  check(
    'inventory reports none of our own tables',
    (await store.inventory()).every((name) => !/^(sessions|observations)/.test(name)),
    (await store.inventory()).join(','),
  );

  if (expected === 'sqlite' || expected === 'libsql') {
    if (expected === 'sqlite') {
      const { DatabaseSync } = await import('node:sqlite');
      const raw = new DatabaseSync(uri);
      raw.exec('CREATE TABLE IF NOT EXISTS orders (id TEXT)');
      raw.close();
    } else {
      await store.client.execute({ sql: 'CREATE TABLE IF NOT EXISTS orders (id TEXT)', args: [] });
    }
    check(
      'inventory reports a table that is not ours',
      (await store.inventory()).includes('orders'),
      (await store.inventory()).join(','),
    );
    if (expected === 'libsql') {
      await store.client.execute({ sql: 'DROP TABLE orders', args: [] });
    }
  }

  const current = await search.search({ text: 'quorbit', project, limit: 5 });
  check(
    're-ingest keeps the newest version searchable',
    current.length === 1 && current[0].title.includes('Quorbit'),
    current.map((h) => h.title).join(' | '),
  );

  const reread = await store.getObservations([revised.id]);
  check(
    're-ingest updates in place rather than duplicating',
    reread.length === 1 && reread[0].body === 'second pass',
    reread[0]?.body,
  );
}
