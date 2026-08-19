import type {
  CodeEdge,
  CodeSymbol,
  Observation,
  ObservationIndexEntry,
  ObservationKind,
  Session,
} from '../../types.js';
import { toSnippet } from '../../util/snippet.js';
import { unpackVector } from '../../util/vector.js';

export type Row = Record<string, unknown>;

export function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return Buffer.alloc(0);
}

export function toSession(row: Row): Session {
  const session: Session = {
    id: row['id'] as string,
    project: row['project'] as string,
    startedAt: Number(row['started_at']),
  };
  if (row['ended_at'] != null) session.endedAt = Number(row['ended_at']);
  if (row['summary'] != null) session.summary = row['summary'] as string;
  return session;
}

export function toObservation(row: Row): Observation {
  const obs: Observation = {
    id: row['id'] as string,
    sessionId: row['session_id'] as string,
    project: row['project'] as string,
    kind: row['kind'] as ObservationKind,
    title: row['title'] as string,
    body: row['body'] as string,
    files: JSON.parse((row['files'] as string) ?? '[]') as string[],
    tags: JSON.parse((row['tags'] as string) ?? '[]') as string[],
    createdAt: Number(row['created_at']),
  };
  if (row['embedding']) obs.embedding = unpackVector(toBuffer(row['embedding']));
  if (row['embedder'] != null) obs.embedder = row['embedder'] as string;
  if (row['author'] != null) obs.author = row['author'] as string;
  if (row['status'] != null) obs.status = row['status'] as NonNullable<Observation['status']>;
  return obs;
}

export function toIndexEntry(row: Row): ObservationIndexEntry {
  const entry: ObservationIndexEntry = {
    id: row['id'] as string,
    kind: row['kind'] as ObservationKind,
    title: row['title'] as string,
    project: row['project'] as string,
    createdAt: Number(row['created_at']),
    score: Number(row['score'] ?? 0),
  };
  const snippet = toSnippet(row['snippet']);
  if (snippet) entry.snippet = snippet;
  return entry;
}

export function toSymbol(row: Row): CodeSymbol {
  return {
    id: row['id'] as string,
    project: row['project'] as string,
    name: row['name'] as string,
    kind: row['kind'] as CodeSymbol['kind'],
    file: row['file'] as string,
    line: Number(row['line']),
    lang: row['lang'] as string,
    signature: (row['signature'] as string) ?? '',
  };
}

export function toEdge(row: Row): CodeEdge {
  return {
    id: row['id'] as string,
    project: row['project'] as string,
    srcId: row['src_id'] as string,
    srcName: row['src_name'] as string,
    dstId: (row['dst_id'] as string) ?? '',
    dstName: row['dst_name'] as string,
    relation: row['relation'] as CodeEdge['relation'],
    confidence: row['confidence'] as CodeEdge['confidence'],
    score: Number(row['score'] ?? 1),
    file: row['file'] as string,
    line: Number(row['line']),
  };
}
