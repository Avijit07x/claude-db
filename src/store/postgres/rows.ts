import type {
  CodeEdge,
  CodeSymbol,
  Observation,
  ObservationIndexEntry,
  ObservationKind,
  Session,
} from '../../types.js';
import { toSnippet } from '../../util/snippet.js';

export function toSession(row: Record<string, unknown>): Session {
  const session: Session = {
    id: row['id'] as string,
    project: row['project'] as string,
    startedAt: Number(row['started_at']),
  };
  if (row['ended_at'] != null) session.endedAt = Number(row['ended_at']);
  if (row['summary'] != null) session.summary = row['summary'] as string;
  return session;
}

export function toObservation(row: Record<string, unknown>): Observation {
  const obs: Observation = {
    id: row['id'] as string,
    sessionId: row['session_id'] as string,
    project: row['project'] as string,
    kind: row['kind'] as ObservationKind,
    title: row['title'] as string,
    body: row['body'] as string,
    files: (row['files'] as string[]) ?? [],
    tags: (row['tags'] as string[]) ?? [],
    createdAt: Number(row['created_at']),
  };
  if (row['embedder'] != null) obs.embedder = row['embedder'] as string;
  if (row['author'] != null) obs.author = row['author'] as string;
  if (row['status'] != null) obs.status = row['status'] as NonNullable<Observation['status']>;
  return obs;
}

export function toIndexEntry(row: Record<string, unknown>): ObservationIndexEntry {
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

export function toSymbol(row: Record<string, unknown>): CodeSymbol {
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

export function toEdge(row: Record<string, unknown>): CodeEdge {
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
