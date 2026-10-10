import type {
  CodeEdge,
  CodeSymbol,
  EdgeFilter,
  ListFilter,
  Observation,
  ObservationIndexEntry,
  ProjectFilter,
  RemoveFilter,
  ScannedFile,
  SearchQuery,
  Session,
  SymbolFilter,
  TimelineQuery,
} from '../types.js';

export interface ProjectSummary {
  project: string;
  observations: number;
  lastActive: number;
}

export interface MemoryStore {
  readonly kind: string;

  init(): Promise<void>;
  close(): Promise<void>;
  ping(): Promise<boolean>;

  linkProject(folder: string, key: string, now?: number): Promise<void>;
  projectScope(folder: string): Promise<string[]>;

  upsertSession(session: Session): Promise<void>;
  getSession(id: string): Promise<Session | null>;
  recentSessions(project: ProjectFilter, limit: number): Promise<Session[]>;

  sessionProjects(): Promise<string[]>;
  clearSummary(id: string): Promise<boolean>;

  insertObservations(observations: Observation[]): Promise<void>;
  getObservations(ids: string[]): Promise<Observation[]>;

  migrateVectorDims?(dims: number): Promise<boolean>;
  storedVectorDims?(): number | null;

  remove(filter: RemoveFilter): Promise<number>;

  list(filter: ListFilter): Promise<Observation[]>;

  listProjects(): Promise<ProjectSummary[]>;

  inventory(): Promise<string[]>;

  searchKeyword(query: SearchQuery): Promise<ObservationIndexEntry[]>;
  searchVector(vector: number[], query: SearchQuery): Promise<ObservationIndexEntry[]>;

  timeline(query: TimelineQuery): Promise<ObservationIndexEntry[]>;

  closeObservations(ids: string[]): Promise<number>;
  markReplaced(ids: string[]): Promise<number>;

  upsertGraph(scan: {
    symbols: CodeSymbol[];
    edges: CodeEdge[];
    files: ScannedFile[];
  }): Promise<void>;

  findSymbols(filter: SymbolFilter): Promise<CodeSymbol[]>;
  findEdges(filter: EdgeFilter): Promise<CodeEdge[]>;
  scannedFiles(project: string): Promise<ScannedFile[]>;

  removeGraph(project: string, files?: string[]): Promise<number>;
}

export function isWholeScope(filter: RemoveFilter): boolean {
  return !filter.ids && !filter.kind && filter.before === undefined;
}

const OURS =
  /^(claude_db_meta|sessions|observations|symbols|symbol_edges|scanned_files|project_links)(_fts(_\w+)?)?$/;

export function foreignNames(names: string[]): string[] {
  return names.filter((name) => name.length > 0 && !OURS.test(name));
}

export interface StoreFactory {
  schemes: string[];
  create(uri: string): Promise<MemoryStore>;
}
