import type {
  CodeEdge,
  CodeSymbol,
  Observation,
  ObservationIndexEntry,
  ObservationKind,
  Session,
} from '../../types.js';
import type { Doc } from './driver.js';
import { toSnippet } from '../../util/snippet.js';

export interface SessionDoc extends Doc {
  _id: string;
  project: string;
  startedAt: number;
  endedAt?: number;
  summary?: string;
}

export interface ObservationDoc extends Doc {
  _id: string;
  sessionId: string;
  project: string;
  kind: ObservationKind;
  title: string;
  body: string;
  files: string[];
  tags: string[];
  createdAt: number;
  embedding?: number[];
  embedder?: string;
  author?: string;
  status?: Observation['status'];
}

export interface SymbolDoc extends Doc {
  _id: string;
  project: string;
  name: string;
  kind: CodeSymbol['kind'];
  file: string;
  line: number;
  lang: string;
  signature: string;
}

export interface EdgeDoc extends Doc {
  _id: string;
  project: string;
  srcId: string;
  srcName: string;
  dstId: string;
  dstName: string;
  relation: CodeEdge['relation'];
  confidence: CodeEdge['confidence'];
  score: number;
  file: string;
  line: number;
}

export interface ScannedFileDoc extends Doc {
  _id: string;
  project: string;
  path: string;
  hash: string;
  scannedAt: number;
}

export function upsertsOf<T extends object>(rows: T[], idOf: (row: T) => string): Doc[] {
  return rows.map((row) => {
    const replacement: Record<string, unknown> = { ...row, _id: idOf(row) };
    delete replacement['id'];
    return {
      replaceOne: { filter: { _id: idOf(row) }, replacement, upsert: true },
    };
  });
}

export function toSession(doc: SessionDoc): Session {
  const session: Session = {
    id: doc._id,
    project: doc.project,
    startedAt: doc.startedAt,
  };
  if (doc.endedAt !== undefined) session.endedAt = doc.endedAt;
  if (doc.summary !== undefined) session.summary = doc.summary;
  return session;
}

export function toDoc(obs: Observation): ObservationDoc {
  const doc: ObservationDoc = {
    _id: obs.id,
    sessionId: obs.sessionId,
    project: obs.project,
    kind: obs.kind,
    title: obs.title,
    body: obs.body,
    files: obs.files,
    tags: obs.tags,
    createdAt: obs.createdAt,
  };
  if (obs.embedding) doc.embedding = obs.embedding;
  if (obs.embedder) doc.embedder = obs.embedder;
  if (obs.author) doc.author = obs.author;
  doc.status = obs.status ?? 'done';
  return doc;
}

export function toObservation(doc: ObservationDoc): Observation {
  const obs: Observation = {
    id: doc._id,
    sessionId: doc.sessionId,
    project: doc.project,
    kind: doc.kind,
    title: doc.title,
    body: doc.body,
    files: doc.files ?? [],
    tags: doc.tags ?? [],
    createdAt: doc.createdAt,
  };
  if (doc.embedding) obs.embedding = doc.embedding;
  if (doc.embedder) obs.embedder = doc.embedder;
  if (doc.author) obs.author = doc.author;
  if (doc.status) obs.status = doc.status;
  return obs;
}

export function toIndexEntry(doc: Partial<ObservationDoc>, score: number): ObservationIndexEntry {
  const entry: ObservationIndexEntry = {
    id: doc._id as string,
    kind: doc.kind as ObservationKind,
    title: doc.title as string,
    project: doc.project as string,
    createdAt: doc.createdAt as number,
    score,
  };
  const snippet = toSnippet((doc as { snippet?: unknown }).snippet);
  if (snippet) entry.snippet = snippet;
  return entry;
}

export function toSymbol(doc: SymbolDoc): CodeSymbol {
  return {
    id: doc._id,
    project: doc.project,
    name: doc.name,
    kind: doc.kind,
    file: doc.file,
    line: doc.line,
    lang: doc.lang,
    signature: doc.signature ?? '',
  };
}

export function toEdge(doc: EdgeDoc): CodeEdge {
  return {
    id: doc._id,
    project: doc.project,
    srcId: doc.srcId,
    srcName: doc.srcName,
    dstId: doc.dstId ?? '',
    dstName: doc.dstName,
    relation: doc.relation,
    confidence: doc.confidence,
    score: doc.score ?? 1,
    file: doc.file,
    line: doc.line,
  };
}
