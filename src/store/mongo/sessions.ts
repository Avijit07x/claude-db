import type { Collection } from './driver.js';
import type { Session } from '../../types.js';
import type { SessionDoc } from './docs.js';
import { toSession } from './docs.js';

export async function upsertSession(
  sessions: Collection<SessionDoc>,
  session: Session,
): Promise<void> {
  const set: Partial<SessionDoc> = {
    project: session.project,
    startedAt: session.startedAt,
  };
  if (session.endedAt !== undefined) set.endedAt = session.endedAt;
  if (session.summary !== undefined) set.summary = session.summary;

  await sessions.updateOne({ _id: session.id }, { $set: set }, { upsert: true });
}

export async function getSession(
  sessions: Collection<SessionDoc>,
  id: string,
): Promise<Session | null> {
  const doc = await sessions.findOne({ _id: id });
  return doc ? toSession(doc) : null;
}

export async function clearSummary(sessions: Collection<SessionDoc>, id: string): Promise<boolean> {
  const result = (await sessions.updateOne({ _id: id }, { $unset: { summary: '' } })) as {
    modifiedCount?: number;
  };
  return (result.modifiedCount ?? 0) > 0;
}

export async function recentSessions(
  sessions: Collection<SessionDoc>,
  project: string,
  limit: number,
): Promise<Session[]> {
  const docs = await sessions
    .find({ project, summary: { $type: 'string' } })
    .sort({ startedAt: -1 })
    .limit(limit)
    .toArray();
  return docs.map(toSession);
}
