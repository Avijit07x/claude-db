import type { Doc } from './driver.js';
import type { ProjectFilter, SearchQuery } from '../../types.js';
import { projectsOf } from '../project-scope.js';

export function projectMatch(filter: ProjectFilter | undefined): Doc {
  const projects = projectsOf(filter);
  if (projects.length === 0) return {};
  const [only] = projects;
  return { project: projects.length === 1 ? only : { $in: projects } };
}

export interface VectorCache {
  atlasVectorIndex: boolean | null;
}

export function scopeFilter(query: SearchQuery): Doc {
  const filter: Record<string, unknown> = {};
  Object.assign(filter, projectMatch(query.project));
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

export function sessionMatch(only: string | undefined, exclude: string[] | undefined): Doc {
  const match: Record<string, unknown> = {};
  if (only) match['$eq'] = only;
  if (exclude && exclude.length > 0) match['$nin'] = exclude;
  return Object.keys(match).length === 0 ? {} : { sessionId: match };
}

export function visibleFilter(query: SearchQuery): Doc {
  return {
    status: { $ne: 'replaced' },
    ...sessionMatch(undefined, query.excludeSessions),
  };
}
