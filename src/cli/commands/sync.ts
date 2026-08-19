import type { MemoryStore } from '../../store/index.js';
import type { Observation } from '../../types.js';
import { BATCH } from '../constants.js';
import { createContext } from '../../context.js';
import { createStore } from '../../store/index.js';

export async function cmdSync(argv: (string | undefined)[]): Promise<void> {
  const url = argv.find((arg) => typeof arg === 'string' && !arg.startsWith('-'));
  const confirmed = argv.includes('--yes') || argv.includes('-y');

  if (!url) {
    console.error('Usage: claude-db sync <connection-string> [--yes]');
    process.exit(1);
  }

  const local = await createContext();
  if (local.config.database === url) {
    await local.close();
    console.error('That is the database memory already uses.');
    process.exit(1);
  }

  const remote = await createStore(url);
  try {
    await remote.init();

    const localIds = new Set<string>();
    await eachRemoteObservation(local.store, (batch) => {
      for (const obs of batch) localIds.add(obs.id);
    });

    const remoteIds = new Set<string>();
    let pulled = 0;
    await eachRemoteObservation(remote, async (batch) => {
      for (const obs of batch) remoteIds.add(obs.id);
      const fresh = batch.filter((obs) => !localIds.has(obs.id));
      if (fresh.length === 0) return;
      pulled += fresh.length;
      if (confirmed) await local.store.insertObservations(fresh);
    });

    let pushed = 0;
    await eachRemoteObservation(local.store, async (batch) => {
      const fresh = batch.filter((obs) => !remoteIds.has(obs.id));
      if (fresh.length === 0) return;
      pushed += fresh.length;
      if (confirmed) await remote.insertObservations(fresh);
    });

    if (!confirmed) {
      console.log(`This would pull ${pulled} and push ${pushed} observation(s).`);
      console.log('\nNothing was transferred. Re-run with --yes to confirm.');
      return;
    }

    const sessions = await syncSessions(local.store, remote);
    console.log(`Pulled ${pulled}, pushed ${pushed}, and reconciled ${sessions} session(s).`);
  } finally {
    await remote.close();
    await local.close();
  }
}

async function syncSessions(local: MemoryStore, remote: MemoryStore): Promise<number> {
  const projects = new Set<string>();
  for (const store of [local, remote]) {
    for (const entry of await store.listProjects()) projects.add(entry.project);
  }

  let moved = 0;
  for (const project of projects) {
    for (const [from, to] of [
      [local, remote],
      [remote, local],
    ] as const) {
      for (const session of await from.recentSessions(project, 1000)) {
        if (await to.getSession(session.id)) continue;
        await to.upsertSession(session);
        moved += 1;
      }
    }
  }
  return moved;
}

async function eachRemoteObservation(
  store: MemoryStore,
  visit: (batch: Observation[]) => Promise<void> | void,
): Promise<void> {
  let after = 0;
  for (;;) {
    const batch = await store.list({ after, limit: BATCH });
    if (batch.length === 0) return;

    await visit(batch);

    const last = batch[batch.length - 1];
    if (!last) return;
    after = last.createdAt === after ? after + 1 : last.createdAt;
    if (batch.length < BATCH) return;
  }
}
