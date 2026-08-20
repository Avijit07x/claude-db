import type { RemoveFilter, SearchQuery } from '../../types.js';
import { partitionIds } from '../../util/shortid.js';
import { resolve } from 'node:path';
import { scopeToken } from '../../util/scope.js';
import { meaningfulTokens } from '../../search/stopwords.js';

export function removeWhere(filter: RemoveFilter): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.ids) {
    const { exact, prefixes } = partitionIds(filter.ids);
    const alternatives: string[] = [];
    if (exact.length > 0) {
      alternatives.push(`id IN (${exact.map(() => '?').join(',')})`);
      params.push(...exact);
    }
    for (const prefix of prefixes) {
      alternatives.push('id GLOB ?');
      params.push(`${prefix}*`);
    }
    conditions.push(`(${alternatives.join(' OR ')})`);
  }
  if (filter.project) {
    conditions.push('project = ?');
    params.push(filter.project);
  }
  if (filter.kind) {
    conditions.push('kind = ?');
    params.push(filter.kind);
  }
  if (filter.before !== undefined) {
    conditions.push('created_at < ?');
    params.push(filter.before);
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

export const TAG_PREDICATE = (prefix: string): string =>
  `EXISTS (SELECT 1 FROM json_each(${prefix}tags) WHERE value = ?)`;

export function appendScope(
  query: SearchQuery,
  conditions: string[],
  params: unknown[],
  prefix: string,
): void {
  if (query.project) {
    conditions.push(`${prefix}project = ?`);
    params.push(query.project);
  }
  if (query.kind) {
    conditions.push(`${prefix}kind = ?`);
    params.push(query.kind);
  }
  if (query.tag) {
    conditions.push(TAG_PREDICATE(prefix));
    params.push(query.tag);
  }
  if (query.since !== undefined) {
    conditions.push(`${prefix}created_at >= ?`);
    params.push(query.since);
  }
  if (query.until !== undefined) {
    conditions.push(`${prefix}created_at <= ?`);
    params.push(query.until);
  }
}

export function toMatchExpression(text: string, project?: string): string | null {
  const tokens = meaningfulTokens(text);

  const scope = project ? `scope:${scopeToken(project)}` : null;

  if (tokens.length === 0) return null;

  const terms = tokens.map((token) => `"${token}"`).join(' OR ');
  return scope ? `${scope} AND (${terms})` : terms;
}

export function toFilePath(uri: string): string {
  if (!uri || uri.trim() === '') {
    return resolve(process.env['HOME'] ?? '.', '.claude-memory/memory.db');
  }
  const stripped = uri.replace(/^(sqlite|file):\/\//, '');
  return resolve(stripped === '' ? './memory.db' : stripped);
}
