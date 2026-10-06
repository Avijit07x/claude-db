import * as observationsOps from './observations.js';
import * as searchOps from './search.js';
import * as sessionsOps from './sessions.js';
import * as graphOps from './graph.js';
import type {
  CodeEdge,
  CodeSymbol,
  EdgeFilter,
  ListFilter,
  Observation,
  ObservationIndexEntry,
  RemoveFilter,
  ScannedFile,
  SearchQuery,
  Session,
  SymbolFilter,
  TimelineQuery,
} from '../../types.js';
import type { MemoryStore, ProjectSummary } from '../adapter.js';
import { DatabaseSync } from 'node:sqlite';
import { toFilePath } from './filters.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync } from 'node:fs';

export const HERE = dirname(fileURLToPath(import.meta.url));

const BUSY_TIMEOUT_MS = 3000;

export class SqliteStore implements MemoryStore {
  readonly kind = 'sqlite';

  private constructor(private readonly db: DatabaseSync) {}

  static async create(uri: string): Promise<SqliteStore> {
    const path = toFilePath(uri);
    mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    return new SqliteStore(db);
  }

  async init(): Promise<void> {
    try {
      this.db.exec(readFileSync(resolve(HERE, 'schema.sql'), 'utf8'));
    } catch (error) {
      if (!/no such module: fts5/i.test(String(error))) throw error;
      throw new Error(
        `This Node's SQLite has no full-text search (FTS5), which claude-db needs. ` +
          `Use Node 22.16 or newer; this is ${process.versions.node}.`,
        { cause: error },
      );
    }

    const row = this.db.prepare('PRAGMA user_version').get() as
      { user_version?: number } | undefined;
    const version = Number(row?.['user_version'] ?? 0);

    if (version < 1) {
      this.db.exec(`INSERT INTO observations_fts(observations_fts) VALUES('rebuild');`);
    }
    if (version < 3) {
      for (const column of [
        'embedder TEXT',
        'author TEXT',
        "status TEXT NOT NULL DEFAULT 'done'",
      ]) {
        try {
          this.db.exec(`ALTER TABLE observations ADD COLUMN ${column}`);
        } catch {}
      }
    }
    if (version < 4) {
      for (const column of ['updated_at INTEGER', 'distilled_at INTEGER']) {
        try {
          this.db.exec(`ALTER TABLE sessions ADD COLUMN ${column}`);
        } catch {}
      }
    }
    if (version < 4) this.db.exec('PRAGMA user_version = 4');
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async ping(): Promise<boolean> {
    return this.db.prepare('SELECT 1 AS ok').get() !== undefined;
  }

  async upsertSession(session: Session): Promise<void> {
    return sessionsOps.upsertSession(this.db, session);
  }

  async getSession(id: string): Promise<Session | null> {
    return sessionsOps.getSession(this.db, id);
  }

  async recentSessions(project: string, limit: number): Promise<Session[]> {
    return sessionsOps.recentSessions(this.db, project, limit);
  }

  async clearSummary(id: string): Promise<boolean> {
    return sessionsOps.clearSummary(this.db, id);
  }

  async insertObservations(observations: Observation[]): Promise<void> {
    return observationsOps.insertObservations(this.db, observations);
  }

  async getObservations(ids: string[]): Promise<Observation[]> {
    return observationsOps.getObservations(this.db, ids);
  }

  async remove(filter: RemoveFilter): Promise<number> {
    return observationsOps.remove(this.db, filter);
  }

  async list(filter: ListFilter): Promise<Observation[]> {
    return observationsOps.list(this.db, filter);
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return observationsOps.listProjects(this.db);
  }

  async sessionProjects(): Promise<string[]> {
    return sessionsOps.sessionProjects(this.db);
  }

  async inventory(): Promise<string[]> {
    return observationsOps.inventory(this.db);
  }

  async searchKeyword(query: SearchQuery): Promise<ObservationIndexEntry[]> {
    return searchOps.searchKeyword(this.db, query);
  }

  async searchVector(vector: number[], query: SearchQuery): Promise<ObservationIndexEntry[]> {
    return searchOps.searchVector(this.db, vector, query);
  }

  async closeObservations(ids: string[]): Promise<number> {
    return observationsOps.closeObservations(this.db, ids);
  }

  async markReplaced(ids: string[]): Promise<number> {
    return observationsOps.markReplaced(this.db, ids);
  }

  async timeline(query: TimelineQuery): Promise<ObservationIndexEntry[]> {
    return searchOps.timeline(this.db, query);
  }

  async upsertGraph(scan: {
    symbols: CodeSymbol[];
    edges: CodeEdge[];
    files: ScannedFile[];
  }): Promise<void> {
    return graphOps.upsertGraph(this.db, scan);
  }

  async findSymbols(filter: SymbolFilter): Promise<CodeSymbol[]> {
    return graphOps.findSymbols(this.db, filter);
  }

  async findEdges(filter: EdgeFilter): Promise<CodeEdge[]> {
    return graphOps.findEdges(this.db, filter);
  }

  async scannedFiles(project: string): Promise<ScannedFile[]> {
    return graphOps.scannedFiles(this.db, project);
  }

  async removeGraph(project: string, files?: string[]): Promise<number> {
    return graphOps.removeGraph(this.db, project, files);
  }
}
