import type { Collection, Doc } from './driver.js';
import type { ObservationIndexEntry, SearchQuery, TimelineQuery } from '../../types.js';
import type { ObservationDoc } from './docs.js';
import { toIndexEntry } from './docs.js';
import { scopeFilter } from './filters.js';

export async function searchKeyword(
  observations: Collection<ObservationDoc>,
  query: SearchQuery,
): Promise<ObservationIndexEntry[]> {
  const filter: Doc = {
    $text: { $search: query.text },
    ...scopeFilter(query),
  };

  const docs = await observations
    .find(filter, {
      projection: {
        kind: 1,
        title: 1,
        project: 1,
        createdAt: 1,
        snippet: { $substrCP: ['$body', 0, 240] },
        score: { $meta: 'textScore' },
      },
    })
    .sort({ score: { $meta: 'textScore' } })
    .limit(query.limit)
    .toArray();

  return docs.map((doc) => toIndexEntry(doc, (doc['score'] as number) ?? 0));
}

export async function timeline(
  observations: Collection<ObservationDoc>,
  query: TimelineQuery,
): Promise<ObservationIndexEntry[]> {
  const anchor = await observations.findOne(
    { _id: query.observationId },
    { projection: { project: 1, createdAt: 1 } },
  );
  if (!anchor) return [];

  const projection = { kind: 1, title: 1, project: 1, createdAt: 1 };

  const [before, after] = await Promise.all([
    observations
      .find({ project: anchor.project, createdAt: { $lte: anchor.createdAt } }, { projection })
      .sort({ createdAt: -1 })
      .limit(query.before + 1)
      .toArray(),
    observations
      .find({ project: anchor.project, createdAt: { $gt: anchor.createdAt } }, { projection })
      .sort({ createdAt: 1 })
      .limit(query.after)
      .toArray(),
  ]);

  return [...before.reverse(), ...after].map((doc) => toIndexEntry(doc, 0));
}

export async function hasAtlasVectorIndex(
  observations: Collection<ObservationDoc>,
): Promise<boolean> {
  try {
    const indexes = await observations.listSearchIndexes().toArray();
    return indexes.some((index) => index['name'] === 'memory_vector');
  } catch {
    return false;
  }
}
