/**
 * Core domain types. Storage-agnostic on purpose: every adapter maps these
 * to its own representation, and nothing outside src/store knows the difference.
 */

export type ObservationKind =
  | 'decision'
  | 'pattern'
  | 'bugfix'
  | 'context'
  | 'deadend'
  | 'preference';

export interface Session {
  /** Stable id supplied by the agent host (Claude Code session id). */
  id: string;
  /** Absolute path of the project root this session ran in. */
  project: string;
  startedAt: number;
  endedAt?: number;
  /** One-paragraph recap written at session end. */
  summary?: string;
}

export interface Observation {
  id: string;
  sessionId: string;
  project: string;
  kind: ObservationKind;
  /** Single-sentence claim. This is what gets ranked and shown in the index. */
  title: string;
  /** Full reasoning, code excerpts, file paths. Fetched only on demand. */
  body: string;
  files: string[];
  tags: string[];
  createdAt: number;
  /** Present only when an embedder is configured. */
  embedding?: number[];
}

/** Compact projection returned by search. Deliberately excludes `body`. */
export interface ObservationIndexEntry {
  id: string;
  kind: ObservationKind;
  title: string;
  project: string;
  createdAt: number;
  score: number;
}

export interface SearchQuery {
  text: string;
  project?: string;
  kind?: ObservationKind;
  since?: number;
  until?: number;
  limit: number;
  /** Ceiling for brute-force vector scans. Ignored by indexed backends. */
  maxScanCandidates?: number;
}

export interface TimelineQuery {
  /** Anchor observation. Results are the ones surrounding it in time. */
  observationId: string;
  before: number;
  after: number;
}
