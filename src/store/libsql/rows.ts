import type { Observation } from '../../types.js';
import type { Row } from './driver.js';
import { toObservation as sqliteObservation } from '../sqlite/rows.js';

export const COLUMNS =
  'id, session_id, project, kind, title, body, files, tags, created_at, embedder, author, status';
export const WITHOUT_BODY = COLUMNS.replace(' body,', '');

export function toObservation(row: Row): Observation {
  const embedding = row['embedding'];
  return sqliteObservation({
    ...row,
    body: row['body'] ?? '',
    embedding: embedding instanceof ArrayBuffer ? Buffer.from(embedding) : embedding,
  });
}

export function changedCount(rowsAffected: number | bigint | undefined): number {
  return Number(rowsAffected ?? 0);
}
