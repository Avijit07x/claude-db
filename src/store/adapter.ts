import type {
  Observation,
  ObservationIndexEntry,
  SearchQuery,
  Session,
  TimelineQuery,
} from '../types.js';

export interface ProjectSummary {
  project: string;
  observations: number;
  lastActive: number;
}

/**
 * The contract every database backend implements.
 *
 * Adapters own persistence only. Ranking, fusion and token budgeting live in
 * src/search so they stay identical no matter which database is plugged in.
 * An adapter that cannot do vectors returns [] from `searchVector`; the search
 * service degrades to keyword-only rather than failing.
 */
export interface MemoryStore {
  readonly kind: string;

  /** Create collections/tables and indexes. Must be idempotent. */
  init(): Promise<void>;
  close(): Promise<void>;
  /** Cheap liveness probe used by `claude-db doctor`. */
  ping(): Promise<boolean>;

  upsertSession(session: Session): Promise<void>;
  getSession(id: string): Promise<Session | null>;
  recentSessions(project: string, limit: number): Promise<Session[]>;

  insertObservations(observations: Observation[]): Promise<void>;
  getObservations(ids: string[]): Promise<Observation[]>;

  /**
   * Deletes memory, scoped to one project or everything when omitted.
   * Returns the number of observations removed.
   *
   * Belongs on the adapter rather than being handled by deleting a file,
   * because on a shared Postgres or Mongo there is no file to delete.
   */
  clear(project?: string): Promise<number>;

  /** Every project with memory in this database, most recently active first. */
  listProjects(): Promise<ProjectSummary[]>;

  /** Lexical match. Returns scores on an adapter-defined scale. */
  searchKeyword(query: SearchQuery): Promise<ObservationIndexEntry[]>;
  /** Vector match. Return [] when the backend has no vector support. */
  searchVector(vector: number[], query: SearchQuery): Promise<ObservationIndexEntry[]>;

  timeline(query: TimelineQuery): Promise<ObservationIndexEntry[]>;
}

export interface StoreFactory {
  /** Lowercase URI schemes this factory claims, e.g. ['mongodb','mongodb+srv']. */
  schemes: string[];
  create(uri: string): Promise<MemoryStore>;
}
