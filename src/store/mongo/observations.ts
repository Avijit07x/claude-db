import type { Collection, Doc } from './driver.js';
import type { ListFilter, Observation, RemoveFilter } from '../../types.js';
import type { ProjectSummary } from '../adapter.js';
import { isWholeScope } from '../adapter.js';
import type { EdgeDoc, ObservationDoc, ScannedFileDoc, SessionDoc, SymbolDoc } from './docs.js';
import { toDoc, toObservation } from './docs.js';
import { escapeRegex } from './helpers.js';
import { partitionIds } from '../../util/shortid.js';

export async function insertObservations(
  collection: Collection<ObservationDoc>,
  sessions: Collection<SessionDoc>,
  symbols: Collection<SymbolDoc>,
  edges: Collection<EdgeDoc>,
  scanned: Collection<ScannedFileDoc>,
  rows: Observation[],
): Promise<void> {
  if (rows.length === 0) return;
  await collection.bulkWrite(
    rows.map((obs) => ({
      replaceOne: {
        filter: { _id: obs.id },
        replacement: toDoc(obs),
        upsert: true,
      },
    })),
    { ordered: false },
  );
}

export async function getObservations(
  observations: Collection<ObservationDoc>,
  sessions: Collection<SessionDoc>,
  symbols: Collection<SymbolDoc>,
  edges: Collection<EdgeDoc>,
  scanned: Collection<ScannedFileDoc>,
  ids: string[],
): Promise<Observation[]> {
  if (ids.length === 0) return [];
  const { exact, prefixes } = partitionIds(ids);

  const or: Record<string, unknown>[] = [];
  if (exact.length > 0) or.push({ _id: { $in: exact } });
  for (const prefix of prefixes) {
    or.push({ _id: { $regex: `^${escapeRegex(prefix)}` } });
  }

  const docs = await observations.find({ $or: or } as Doc).toArray();
  return docs.map(toObservation);
}

export async function remove(
  observations: Collection<ObservationDoc>,
  sessions: Collection<SessionDoc>,
  symbols: Collection<SymbolDoc>,
  edges: Collection<EdgeDoc>,
  scanned: Collection<ScannedFileDoc>,
  filter: RemoveFilter,
): Promise<number> {
  if (filter.ids?.length === 0) return 0;

  const query: Record<string, unknown> = {};
  if (filter.project) query['project'] = filter.project;
  if (filter.kind) query['kind'] = filter.kind;
  if (filter.before !== undefined) query['createdAt'] = { $lt: filter.before };

  if (filter.ids) {
    const { exact, prefixes } = partitionIds(filter.ids);
    const alternatives: Record<string, unknown>[] = [];
    if (exact.length > 0) alternatives.push({ _id: { $in: exact } });
    for (const prefix of prefixes) {
      alternatives.push({ _id: { $regex: `^${escapeRegex(prefix)}` } });
    }
    query['$or'] = alternatives;
  }

  const count = await observations.countDocuments(query as Doc);
  await observations.deleteMany(query as Doc);
  if (isWholeScope(filter)) {
    const scope = filter.project ? { project: filter.project } : {};
    await sessions.deleteMany(scope);
    await symbols.deleteMany(scope);
    await edges.deleteMany(scope);
    await scanned.deleteMany(scope);
  }
  return count;
}

export async function list(
  observations: Collection<ObservationDoc>,
  sessions: Collection<SessionDoc>,
  symbols: Collection<SymbolDoc>,
  edges: Collection<EdgeDoc>,
  scanned: Collection<ScannedFileDoc>,
  filter: ListFilter,
): Promise<Observation[]> {
  const query: Record<string, unknown> = {};
  if (filter.project) query['project'] = filter.project;
  if (filter.kind) query['kind'] = filter.kind;
  if (filter.status) query['status'] = filter.status;
  if (filter.after !== undefined) query['createdAt'] = { $gt: filter.after };

  const docs = await observations
    .find(query as Doc)
    .sort({ createdAt: 1 })
    .limit(filter.limit ?? 1000)
    .toArray();
  return docs.map(toObservation);
}

export async function listProjects(
  observations: Collection<ObservationDoc>,
  sessions: Collection<SessionDoc>,
  symbols: Collection<SymbolDoc>,
  edges: Collection<EdgeDoc>,
  scanned: Collection<ScannedFileDoc>,
): Promise<ProjectSummary[]> {
  const rows = await observations
    .aggregate<{ _id: string; n: number; last: number }>([
      { $group: { _id: '$project', n: { $sum: 1 }, last: { $max: '$createdAt' } } },
      { $sort: { last: -1 } },
    ])
    .toArray();

  return rows.map((row) => ({
    project: row._id,
    observations: row.n,
    lastActive: row.last,
  }));
}

export async function closeObservations(
  observations: Collection<ObservationDoc>,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const filter = { _id: { $in: ids }, status: 'open' } as Doc;
  const n = await observations.countDocuments(filter);
  await observations.updateMany(filter, { $set: { status: 'done' } });
  return n;
}
