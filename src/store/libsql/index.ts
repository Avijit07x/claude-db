import * as insertOps from './insert.js';
import * as observationsOps from './observations.js';
import * as searchOps from './search.js';
import * as sessionsOps from './sessions.js';
import * as graphOps from './graph.js';
import * as projectLinksOps from './project-links.js';
import type {
  CodeEdge,
  CodeSymbol,
  CountFilter,
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
} from '../../types.js';
import type { GraphRows, MemoryStore, ProjectSummary } from '../adapter.js';
import type { Client } from './driver.js';
import { openClient } from './driver.js';
import { DDL, SCHEMA_VERSION, WRITE_VERSION } from './schema.js';
import { clearMarker, guarded, markerPath, readMarker, writeMarker } from './schema-guard.js';
import { SCOPE_TTL_MS } from '../project-resolver.js';

const scopes = new Map<string, { at: number; scope: Promise<string[]> }>();

export class LibsqlStore implements MemoryStore {
  readonly kind = 'libsql';
  private readonly client: Client;

  constructor(
    private readonly raw: Client,
    private readonly marker: string | null = null,
  ) {
    this.client = marker === null ? raw : guarded(raw, () => this.createSchema());
  }

  static async create(uri: string): Promise<LibsqlStore> {
    return new LibsqlStore(await openClient(uri), markerPath(uri));
  }

  async init(): Promise<void> {
    if (this.marker !== null && readMarker(this.marker) === SCHEMA_VERSION) return;
    if ((await this.schemaVersion()) === SCHEMA_VERSION) {
      if (this.marker !== null) writeMarker(this.marker, SCHEMA_VERSION);
      return;
    }
    await this.createSchema();
  }

  private async createSchema(): Promise<void> {
    if (this.marker !== null) clearMarker(this.marker);
    const statements = [...DDL, WRITE_VERSION].map((sql) => ({
      sql,
      args: sql === WRITE_VERSION ? [SCHEMA_VERSION] : [],
    }));
    try {
      await this.raw.batch(statements, 'write');
    } catch (error) {
      if (!/fts5/i.test(String(error))) throw error;
      throw new Error(
        'This libSQL database has no full-text search (FTS5), which claude-db needs. ' +
          'On Turso, use a libSQL database: one made with `turso db create --tursodb` ' +
          'runs the newer engine, which has no FTS5.',
        { cause: error },
      );
    }
    if (this.marker !== null) writeMarker(this.marker, SCHEMA_VERSION);
  }

  async schemaVersion(): Promise<number | null> {
    try {
      const res = await this.raw.execute({
        sql: 'SELECT version FROM claude_db_meta WHERE id = 1',
        args: [],
      });
      const version = res.rows[0]?.['version'];
      return version == null ? null : Number(version);
    } catch {
      return null;
    }
  }

  close(): Promise<void> {
    this.raw.close();
    return Promise.resolve();
  }

  async ping(): Promise<boolean> {
    const res = await this.client.execute({ sql: 'SELECT 1 AS ok', args: [] });
    return res.rows.length === 1;
  }

  async linkProject(folder: string, key: string, now = Date.now()): Promise<void> {
    this.forgetScopes();
    await projectLinksOps.linkProject(this.client, folder, key, now);
    this.forgetScopes();
  }

  async projectScope(folder: string): Promise<string[]> {
    if (this.marker === null) return projectLinksOps.projectScope(this.client, folder);
    const key = `${this.marker}\u0000${folder}`;
    const cached = scopes.get(key);
    if (cached && Date.now() - cached.at < SCOPE_TTL_MS) return cached.scope;
    const scope = projectLinksOps.projectScope(this.client, folder);
    scopes.set(key, { at: Date.now(), scope });
    scope.catch(() => scopes.delete(key));
    return scope;
  }

  private forgetScopes(): void {
    for (const key of [...scopes.keys()]) {
      if (key.startsWith(`${this.marker}\u0000`)) scopes.delete(key);
    }
  }

  async upsertSession(session: Session): Promise<void> {
    return sessionsOps.upsertSession(this.client, session);
  }

  async getSession(id: string): Promise<Session | null> {
    return sessionsOps.getSession(this.client, id);
  }

  async recentSessions(project: ProjectFilter, limit: number): Promise<Session[]> {
    return sessionsOps.recentSessions(this.client, project, limit);
  }

  async sessionProjects(): Promise<string[]> {
    return sessionsOps.sessionProjects(this.client);
  }

  async clearSummary(id: string): Promise<boolean> {
    return sessionsOps.clearSummary(this.client, id);
  }

  async insertObservations(observations: Observation[]): Promise<void> {
    return insertOps.insertObservations(this.client, observations);
  }

  async getObservations(ids: string[]): Promise<Observation[]> {
    return observationsOps.getObservations(this.client, ids);
  }

  async remove(filter: RemoveFilter): Promise<number> {
    return observationsOps.remove(this.client, filter);
  }

  async list(filter: ListFilter): Promise<Observation[]> {
    return observationsOps.list(this.client, filter);
  }

  async count(filter: CountFilter): Promise<number> {
    return observationsOps.count(this.client, filter);
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return observationsOps.listProjects(this.client);
  }

  async inventory(): Promise<string[]> {
    return observationsOps.inventory(this.client);
  }

  async searchKeyword(query: SearchQuery): Promise<ObservationIndexEntry[]> {
    return searchOps.searchKeyword(this.client, query);
  }

  async searchVector(vector: number[], query: SearchQuery): Promise<ObservationIndexEntry[]> {
    return searchOps.searchVector(this.client, vector, query);
  }

  async timeline(query: TimelineQuery): Promise<ObservationIndexEntry[]> {
    return searchOps.timeline(this.client, query);
  }

  async closeObservations(ids: string[]): Promise<number> {
    return observationsOps.closeObservations(this.client, ids);
  }

  async markReplaced(ids: string[]): Promise<number> {
    return observationsOps.markReplaced(this.client, ids);
  }

  async upsertGraph(scan: GraphRows): Promise<void> {
    return graphOps.upsertGraph(this.client, scan);
  }

  async replaceGraph(project: string, files: string[] | null, scan: GraphRows): Promise<void> {
    return graphOps.replaceGraph(this.client, project, files, scan);
  }

  async findSymbols(filter: SymbolFilter): Promise<CodeSymbol[]> {
    return graphOps.findSymbols(this.client, filter);
  }

  async symbolNames(project: string, limit: number): Promise<string[]> {
    return graphOps.symbolNames(this.client, project, limit);
  }

  async findEdges(filter: EdgeFilter): Promise<CodeEdge[]> {
    return graphOps.findEdges(this.client, filter);
  }

  async scannedFiles(project: string, limit?: number): Promise<ScannedFile[]> {
    return graphOps.scannedFiles(this.client, project, limit);
  }

  async removeGraph(project: string, files?: string[]): Promise<number> {
    return graphOps.removeGraph(this.client, project, files);
  }
}
