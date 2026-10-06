import type { MemoryStore } from '../../store/index.js';
import type { Observation, ObservationStatus, Session } from '../../types.js';
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

    const localStatus = new Map<string, ObservationStatus>();
    await eachRemoteObservation(local.store, (batch) => {
      for (const obs of batch) localStatus.set(obs.id, obs.status ?? 'done');
    });

    const remoteStatus = new Map<string, ObservationStatus>();
    let pulled = 0;
    await eachRemoteObservation(remote, async (batch) => {
      for (const obs of batch) remoteStatus.set(obs.id, obs.status ?? 'done');
      const fresh = batch.filter((obs) => !localStatus.has(obs.id));
      if (fresh.length === 0) return;
      pulled += fresh.length;
      if (confirmed) await local.store.insertObservations(fresh);
    });

    let pushed = 0;
    await eachRemoteObservation(local.store, async (batch) => {
      const fresh = batch.filter((obs) => !remoteStatus.has(obs.id));
      if (fresh.length === 0) return;
      pushed += fresh.length;
      if (confirmed) await remote.insertObservations(fresh);
    });

    const localBehind = statusBehind(localStatus, remoteStatus);
    const remoteBehind = statusBehind(remoteStatus, localStatus);
    const moved = count(localBehind) + count(remoteBehind);

    if (!confirmed) {
      console.log(
        `This would pull ${pulled} and push ${pushed} observation(s), ` +
          `and bring ${moved} status(es) up to date.`,
      );
      console.log('\nNothing was transferred. Re-run with --yes to confirm.');
      return;
    }

    await applyStatus(local.store, localBehind);
    await applyStatus(remote, remoteBehind);
    const sessions = await syncSessions(local.store, remote);
    console.log(
      `Pulled ${pulled}, pushed ${pushed}, brought ${moved} status(es) up to date, ` +
        `and reconciled ${sessions} session(s).`,
    );
  } finally {
    await remote.close();
    await local.close();
  }
}

const STATUS_ORDER: Record<ObservationStatus, number> = { open: 0, done: 1, replaced: 2 };

interface StatusUpdates {
  done: string[];
  replaced: string[];
}

function statusBehind(
  mine: Map<string, ObservationStatus>,
  theirs: Map<string, ObservationStatus>,
): StatusUpdates {
  const updates: StatusUpdates = { done: [], replaced: [] };
  for (const [id, status] of theirs) {
    const own = mine.get(id);
    if (own === undefined) continue;
    const ownRank = STATUS_ORDER[own] ?? -1;
    const theirRank = STATUS_ORDER[status] ?? -1;
    if (ownRank < 0 || theirRank <= ownRank) continue;
    if (status === 'done') updates.done.push(id);
    if (status === 'replaced') updates.replaced.push(id);
  }
  return updates;
}

function count(updates: StatusUpdates): number {
  return updates.done.length + updates.replaced.length;
}

async function applyStatus(store: MemoryStore, updates: StatusUpdates): Promise<void> {
  for (let start = 0; start < updates.done.length; start += BATCH) {
    await store.closeObservations(updates.done.slice(start, start + BATCH));
  }
  for (let start = 0; start < updates.replaced.length; start += BATCH) {
    await store.markReplaced(updates.replaced.slice(start, start + BATCH));
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
        if (await reconcileSession(session, from, to)) moved += 1;
      }
    }
  }
  return moved;
}

async function reconcileSession(
  session: Session,
  from: MemoryStore,
  to: MemoryStore,
): Promise<boolean> {
  const other = await to.getSession(session.id);
  if (!other) {
    await to.upsertSession(session);
    return true;
  }

  const ours = session.updatedAt ?? 0;
  const theirs = other.updatedAt ?? 0;
  if (other.summary !== session.summary && ours > theirs) {
    await to.upsertSession(session);
    return true;
  }
  if (other.summary === undefined && theirs > ours) {
    await from.clearSummary(session.id);
    return true;
  }
  if (session.distilledAt !== undefined && other.distilledAt === undefined) {
    await to.upsertSession({
      id: other.id,
      project: other.project,
      startedAt: other.startedAt,
      distilledAt: session.distilledAt,
    });
    return true;
  }
  return false;
}

async function eachRemoteObservation(
  store: MemoryStore,
  visit: (batch: Observation[]) => Promise<void> | void,
): Promise<void> {
  let after: number | undefined;
  let afterId: string | undefined;
  for (;;) {
    const batch = await store.list({
      ...(after === undefined ? {} : { after }),
      ...(afterId === undefined ? {} : { afterId }),
      limit: BATCH,
    });
    if (batch.length === 0) return;

    await visit(batch);

    const last = batch[batch.length - 1];
    if (!last) return;
    after = last.createdAt;
    afterId = last.id;
    if (batch.length < BATCH) return;
  }
}
