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
  /** Which embedder produced `embedding`. Absent on rows written before 0.2. */
  embedder?: string;
  /** Whose machine recorded this. Only interesting on a shared database. */
  author?: string;
}

/** Compact projection returned by search. Deliberately excludes `body`. */
export interface ObservationIndexEntry {
  id: string;
  kind: ObservationKind;
  title: string;
  project: string;
  createdAt: number;
  score: number;
  /**
   * A line of the body around the match, so a result can be chosen without
   * being expanded first. Produced by the keyword retriever, which is the only
   * one with query terms to centre on; a row found by vector similarity alone
   * has none.
   */
  snippet?: string;
}

export interface SearchQuery {
  text: string;
  project?: string;
  kind?: ObservationKind;
  /**
   * Narrows to observations touching one repository or top-level directory.
   *
   * A workspace that pools several repositories under one project key gets a
   * memory covering all of them, and "the backend only" is a natural thing to
   * ask that could not be expressed: tags were recorded and ranked, but never
   * filtered on.
   */
  tag?: string;
  since?: number;
  until?: number;
  limit: number;
  /** Ceiling for brute-force vector scans. Ignored by indexed backends. */
  maxScanCandidates?: number;
  /**
   * Restricts vector search to rows embedded by this model, plus rows that
   * predate the column. Vectors from different models are not comparable.
   */
  embedder?: string;
}

/**
 * What to delete. Every field narrows, and an empty filter means everything,
 * which is what `reset` asks for. An explicitly empty `ids` array deletes
 * nothing: `forget` with no resolvable id must not wipe the database.
 */
export interface RemoveFilter {
  ids?: string[];
  project?: string;
  kind?: ObservationKind;
  /** Deletes observations recorded strictly before this timestamp. */
  before?: number;
}

/** Bulk read, ordered oldest first so `after` can page through a large table. */
export interface ListFilter {
  project?: string;
  kind?: ObservationKind;
  after?: number;
  limit?: number;
}

export interface TimelineQuery {
  /** Anchor observation. Results are the ones surrounding it in time. */
  observationId: string;
  before: number;
  after: number;
}
