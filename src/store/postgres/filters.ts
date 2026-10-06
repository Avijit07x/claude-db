import type { SearchQuery } from '../../types.js';

export function appendScope(query: SearchQuery, conditions: string[], values: unknown[]): void {
  conditions.push("status <> 'replaced'");
  if (query.project) {
    values.push(query.project);
    conditions.push(`project = $${values.length}`);
  }
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
  if (query.excludeSessions && query.excludeSessions.length > 0) {
    values.push(query.excludeSessions);
    conditions.push(`session_id <> ALL($${values.length}::text[])`);
  }
}
