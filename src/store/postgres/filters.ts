import type { ProjectFilter, SearchQuery } from '../../types.js';
import { projectsOf } from '../project-scope.js';

export function projectClause(
  filter: ProjectFilter | undefined,
  values: unknown[],
  column = 'project',
): string | null {
  const projects = projectsOf(filter);
  if (projects.length === 0) return null;
  values.push(projects);
  return `${column} = ANY($${values.length}::text[])`;
}

export function excludeSessionsClause(
  sessions: string[] | undefined,
  values: unknown[],
): string | null {
  if (!sessions || sessions.length === 0) return null;
  values.push(sessions);
  return `session_id <> ALL($${values.length}::text[])`;
}

export function appendScope(query: SearchQuery, conditions: string[], values: unknown[]): void {
  conditions.push("status <> 'replaced'");
  const project = projectClause(query.project, values);
  if (project) conditions.push(project);
  if (query.kind) {
    values.push(query.kind);
    conditions.push(`kind = $${values.length}`);
  }
  if (query.tag) {
    values.push(JSON.stringify([query.tag]));
    conditions.push(`tags @> $${values.length}::jsonb`);
  }
  if (query.since !== undefined) {
    values.push(query.since);
    conditions.push(`created_at >= $${values.length}`);
  }
  if (query.until !== undefined) {
    values.push(query.until);
    conditions.push(`created_at <= $${values.length}`);
  }
  const excluded = excludeSessionsClause(query.excludeSessions, values);
  if (excluded) conditions.push(excluded);
}
