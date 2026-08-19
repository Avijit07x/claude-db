import * as vectorSearchOps from './vectorSearch.js';
import * as searchOps from './search.js';
import { scopeFilter } from './filters.js';
import type { VectorCache } from './filters.js';
import * as observationsOps from './observations.js';
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
import type { Collection, Db, Doc, MongoClient } from './driver.js';
import type { MemoryStore, ProjectSummary } from '../adapter.js';
import {
  EdgeDoc,
  ObservationDoc,
  ScannedFileDoc,
  SessionDoc,
  SymbolDoc,
  toDoc,
  toEdge,
  toIndexEntry,
  toObservation,
  toSession,
  toSymbol,
  upsertsOf,
} from './docs.js';
import { cosine } from '../../util/vector.js';
import { databaseNameFrom, escapeRegex } from './helpers.js';
import { foreignNames, isWholeScope } from '../adapter.js';
import { importMongo } from './driver.js';
import { partitionIds } from '../../util/shortid.js';

export class MongoStore implements MemoryStore {
  readonly kind = 'mongodb';

  private readonly cache: VectorCache = { atlasVectorIndex: null };

  private constructor(
    private readonly client: MongoClient,
    private readonly db: Db,
    private readonly sessions: Collection<SessionDoc>,
    private readonly observations: Collection<ObservationDoc>,
    private readonly symbols: Collection<SymbolDoc>,
    private readonly edges: Collection<EdgeDoc>,
    private readonly scanned: Collection<ScannedFileDoc>,
  ) {}

  static async create(uri: string): Promise<MongoStore> {
    const mongo = await importMongo();
    const client = new mongo.MongoClient(uri);
    await client.connect();
    const db = client.db(databaseNameFrom(uri) ?? 'claude_memory_db');
    return new MongoStore(
      client,
      db,
      db.collection<SessionDoc>('sessions'),
      db.collection<ObservationDoc>('observations'),
      db.collection<SymbolDoc>('symbols'),
      db.collection<EdgeDoc>('symbol_edges'),
      db.collection<ScannedFileDoc>('scanned_files'),
    );
  }

  async init(): Promise<void> {
    await this.sessions.createIndex({ project: 1, startedAt: -1 });
    await this.observations.createIndex({ project: 1, createdAt: -1 });
    await this.observations.createIndex({ project: 1, kind: 1, createdAt: -1 });
    await this.observations.createIndex(
      { title: 'text', body: 'text', tags: 'text' },
      { name: 'memory_text', weights: { title: 10, tags: 5, body: 1 } },
    );
    await this.symbols.createIndex({ project: 1, name: 1 });
    await this.symbols.createIndex({ project: 1, file: 1 });
    await this.edges.createIndex({ project: 1, srcId: 1 });
    await this.edges.createIndex({ project: 1, dstId: 1 });
    await this.edges.createIndex({ project: 1, file: 1 });
    await this.scanned.createIndex({ project: 1, path: 1 }, { unique: true });
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async ping(): Promise<boolean> {
    const res = await this.db.command({ ping: 1 });
    return res['ok'] === 1;
  }

  async upsertSession(session: Session): Promise<void> {
    return sessionsOps.upsertSession(this.sessions, session);
  }

  async getSession(id: string): Promise<Session | null> {
    return sessionsOps.getSession(this.sessions, id);
  }

  async recentSessions(project: string, limit: number): Promise<Session[]> {
    return sessionsOps.recentSessions(this.sessions, project, limit);
  }

  async insertObservations(observations: Observation[]): Promise<void> {
    return observationsOps.insertObservations(
      this.observations,
      this.sessions,
      this.symbols,
      this.edges,
      this.scanned,
      observations,
    );
  }

  async getObservations(ids: string[]): Promise<Observation[]> {
    return observationsOps.getObservations(
      this.observations,
      this.sessions,
      this.symbols,
      this.edges,
      this.scanned,
      ids,
    );
  }

  async remove(filter: RemoveFilter): Promise<number> {
    return observationsOps.remove(
      this.observations,
      this.sessions,
      this.symbols,
      this.edges,
      this.scanned,
      filter,
    );
  }

  async list(filter: ListFilter): Promise<Observation[]> {
    return observationsOps.list(
      this.observations,
      this.sessions,
      this.symbols,
      this.edges,
      this.scanned,
      filter,
    );
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return observationsOps.listProjects(
      this.observations,
      this.sessions,
      this.symbols,
      this.edges,
      this.scanned,
    );
  }

  async inventory(): Promise<string[]> {
    const res = await this.db.command({ listCollections: 1, nameOnly: true });
    const batch = (res['cursor'] as { firstBatch?: Doc[] } | undefined)?.firstBatch ?? [];
    return foreignNames(batch.map((doc) => String(doc['name'] ?? '')));
  }

  async searchKeyword(query: SearchQuery): Promise<ObservationIndexEntry[]> {
    return searchOps.searchKeyword(this.observations, query);
  }

  async searchVector(vector: number[], query: SearchQuery): Promise<ObservationIndexEntry[]> {
    return vectorSearchOps.searchVector(this.observations, this.cache, vector, query);
  }

  async closeObservations(ids: string[]): Promise<number> {
    return observationsOps.closeObservations(this.observations, ids);
  }

  async timeline(query: TimelineQuery): Promise<ObservationIndexEntry[]> {
    return searchOps.timeline(this.observations, query);
  }

  async hasAtlasVectorIndex(): Promise<boolean> {
    return searchOps.hasAtlasVectorIndex(this.observations);
  }

  async upsertGraph(scan: {
    symbols: CodeSymbol[];
    edges: CodeEdge[];
    files: ScannedFile[];
  }): Promise<void> {
    return graphOps.upsertGraph(this.symbols, this.edges, this.scanned, scan);
  }

  async findSymbols(filter: SymbolFilter): Promise<CodeSymbol[]> {
    return graphOps.findSymbols(this.symbols, this.edges, this.scanned, filter);
  }

  async findEdges(filter: EdgeFilter): Promise<CodeEdge[]> {
    return graphOps.findEdges(this.symbols, this.edges, this.scanned, filter);
  }

  async scannedFiles(project: string): Promise<ScannedFile[]> {
    return graphOps.scannedFiles(this.symbols, this.edges, this.scanned, project);
  }

  async removeGraph(project: string, files?: string[]): Promise<number> {
    return graphOps.removeGraph(this.symbols, this.edges, this.scanned, project, files);
  }
}
