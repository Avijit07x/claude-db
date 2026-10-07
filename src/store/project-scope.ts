import type { ProjectFilter } from '../types.js';

export function projectsOf(filter: ProjectFilter | undefined): string[] {
  if (filter === undefined) return [];
  const values = typeof filter === 'string' ? [filter] : filter;
  return [...new Set(values.filter((value) => value.length > 0))];
}

export function noProjects(filter: ProjectFilter | undefined): boolean {
  return typeof filter !== 'string' && filter !== undefined && projectsOf(filter).length === 0;
}

export function isLinkable(folder: string, key: string): boolean {
  return folder.trim().length > 0 && key.trim().length > 0 && folder !== key;
}

export function orderScope(folder: string, related: Iterable<string>): string[] {
  const others = [...new Set(related)].filter((value) => value !== folder).sort();
  return [folder, ...others];
}
