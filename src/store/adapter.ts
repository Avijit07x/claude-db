import type {
  ListFilter,
  Observation,
  ObservationIndexEntry,
  RemoveFilter,
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
   * Deletes memory matching a filter, returning how many observations went.
   *
   * One method rather than three because `reset`, `prune` and `forget` differ
   * only in how they narrow. Belongs on the adapter rather than being handled
   * by deleting a file, because on a shared Postgres or Mongo there is none.
   *
   * Sessions are removed only for a whole-project or whole-database wipe; a
   * pruned or forgotten observation leaves its session intact.
   */
  remove(filter: RemoveFilter): Promise<number>;

  /**
   * Bulk read, oldest first, for export, re-embedding and statistics. Paged by
   * `after` + `limit` so a large database is never held in memory at once.
   */
  list(filter: ListFilter): Promise<Observation[]>;

  /** Every project with memory in this database, most recently active first. */
  listProjects(): Promise<ProjectSummary[]>;

  /** Lexical match. Returns scores on an adapter-defined scale. */
  searchKeyword(query: SearchQuery): Promise<ObservationIndexEntry[]>;
  /** Vector match. Return [] when the backend has no vector support. */
  searchVector(vector: number[], query: SearchQuery): Promise<ObservationIndexEntry[]>;

  timeline(query: TimelineQuery): Promise<ObservationIndexEntry[]>;
}

/**
 * True when a filter names a whole project, or the whole database.
 *
 * Sessions follow their observations only in that case: pruning by date or
 * forgetting one row must leave the session record alone, or the recap at
 * SessionStart loses sessions whose work is still there.
 */
export function isWholeScope(filter: RemoveFilter): boolean {
  return !filter.ids && !filter.kind && filter.before === undefined;
}

export interface StoreFactory {
  /** Lowercase URI schemes this factory claims, e.g. ['mongodb','mongodb+srv']. */
  schemes: string[];
  create(uri: string): Promise<MemoryStore>;
}
