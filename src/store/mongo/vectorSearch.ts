import type { Collection } from './driver.js';
import type { ObservationIndexEntry, SearchQuery } from '../../types.js';
import type { ObservationDoc } from './docs.js';
import { toIndexEntry } from './docs.js';
import { scopeFilter } from './filters.js';
import type { VectorCache } from './filters.js';
import * as searchOps from './search.js';
import { cosine } from '../../util/vector.js';

export async function searchVector(
  observations: Collection<ObservationDoc>,
  cache: VectorCache,
  vector: number[],
  query: SearchQuery,
): Promise<ObservationIndexEntry[]> {
  if (cache.atlasVectorIndex === null) {
    cache.atlasVectorIndex = await searchOps.hasAtlasVectorIndex(observations);
  }

  if (cache.atlasVectorIndex) {
    const docs = await observations
      .aggregate<ObservationDoc & { score: number }>([
        {
          $vectorSearch: {
            index: 'memory_vector',
            path: 'embedding',
            queryVector: vector,
            numCandidates: Math.max(query.limit * 10, 100),
            limit: query.limit,
            filter: scopeFilter(query),
          },
        },
        ...(query.embedder
          ? [
              {
                $match: { $or: [{ embedder: query.embedder }, { embedder: { $exists: false } }] },
              },
            ]
          : []),
        {
          $project: {
            kind: 1,
            title: 1,
            project: 1,
            createdAt: 1,
            score: { $meta: 'vectorSearchScore' },
          },
        },
      ])
      .toArray();
    return docs.map((doc) => toIndexEntry(doc, doc.score));
  }

  const docs = await observations
    .find(
      {
        embedding: { $exists: true },
        ...(query.embedder
          ? { $or: [{ embedder: query.embedder }, { embedder: { $exists: false } }] }
          : {}),
        ...scopeFilter(query),
      },
      { projection: { kind: 1, title: 1, project: 1, createdAt: 1, embedding: 1 } },
    )
    .sort({ createdAt: -1 })
    .limit(query.maxScanCandidates ?? 25000)
    .toArray();

  return docs
    .map((doc) => toIndexEntry(doc, doc.embedding ? cosine(vector, doc.embedding) : 0))
    .sort((a, b) => b.score - a.score)
    .slice(0, query.limit);
}
