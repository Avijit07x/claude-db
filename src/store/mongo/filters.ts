import type { Doc } from './driver.js';
import type { SearchQuery } from '../../types.js';

export interface VectorCache {
  atlasVectorIndex: boolean | null;
}

export function scopeFilter(query: SearchQuery): Doc {
  const filter: Record<string, unknown> = {};
  if (query.project) filter['project'] = query.project;
  if (query.kind) filter['kind'] = query.kind;
  if (query.tag) filter['tags'] = query.tag;
  if (query.since !== undefined || query.until !== undefined) {
    const range: Record<string, number> = {};
    if (query.since !== undefined) range['$gte'] = query.since;
    if (query.until !== undefined) range['$lte'] = query.until;
    filter['createdAt'] = range;
  }
  return filter;
}
