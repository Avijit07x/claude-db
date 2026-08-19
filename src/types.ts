export type ObservationKind =
  'decision' | 'pattern' | 'bugfix' | 'context' | 'deadend' | 'preference';

export interface Session {
  id: string;
  project: string;
  startedAt: number;
  endedAt?: number;
  summary?: string;
}

export type ObservationStatus = 'open' | 'done';

export interface Observation {
  id: string;
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
  status?: ObservationStatus;
}

export interface ObservationIndexEntry {
  id: string;
  kind: ObservationKind;
  title: string;
  project: string;
  createdAt: number;
  score: number;
  snippet?: string;
}

export interface SearchQuery {
  text: string;
  project?: string;
  kind?: ObservationKind;
  tag?: string;
  since?: number;
  until?: number;
  limit: number;
  maxScanCandidates?: number;
  embedder?: string;
}

export interface RemoveFilter {
  ids?: string[];
  project?: string;
  kind?: ObservationKind;
  before?: number;
}

export interface ListFilter {
  project?: string;
  kind?: ObservationKind;
  status?: ObservationStatus;
  after?: number;
  limit?: number;
}

export interface TimelineQuery {
  observationId: string;
  before: number;
  after: number;
}

export type SymbolKind = 'function' | 'class' | 'interface' | 'type' | 'enum' | 'const' | 'method';

export type EdgeRelation =
  'calls' | 'imports' | 'extends' | 'implements' | 'references' | 'defines';

export type EdgeConfidence = 'EXTRACTED' | 'INFERRED';

export interface CodeSymbol {
  id: string;
  project: string;
  name: string;
  kind: SymbolKind;
  file: string;
  line: number;
  lang: string;
  signature: string;
}

export interface CodeEdge {
  id: string;
  project: string;
  srcId: string;
  srcName: string;
  dstId: string;
  dstName: string;
  relation: EdgeRelation;
  confidence: EdgeConfidence;
  score: number;
  file: string;
  line: number;
}

export interface SymbolFilter {
  project: string;
  name?: string;
  file?: string;
  limit?: number;
}

export interface EdgeFilter {
  project: string;
  srcIds?: string[];
  dstIds?: string[];
  limit?: number;
}

export interface ScannedFile {
  project: string;
  path: string;
  hash: string;
  scannedAt: number;
}
