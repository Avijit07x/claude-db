import * as insertOps from './insert.js';
import * as metaOps from './meta.js';
import * as vectorSearchOps from './vectorSearch.js';
import * as searchOps from './search.js';
import { appendScope } from './filters.js';
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
import type { MemoryStore, ProjectSummary } from '../adapter.js';
import { Pool, importPg } from './driver.js';
import { DDL, SCHEMA_VERSION, TSV_EXPRESSION } from './schema.js';
import { foreignNames, isWholeScope } from '../adapter.js';
import { partitionIds } from '../../util/shortid.js';
import { toEdge, toIndexEntry, toObservation, toSession, toSymbol } from './rows.js';

export class PostgresStore implements MemoryStore {
  readonly kind = 'postgres';

  private vectorEnabled = false;

  private vectorDims: number | null = null;

  private warnedDims = false;

  private constructor(private readonly pool: Pool) {}

  static async create(uri: string): Promise<PostgresStore> {
    const pg = await importPg();
    const pool = new pg.Pool({ connectionString: uri });
    return new PostgresStore(pool);
  }

  async init(): Promise<void> {
    const meta = await this.readMeta();
    if (meta?.version === SCHEMA_VERSION) {
      this.vectorEnabled = meta.vectorEnabled;
      this.vectorDims = meta.vectorDims;
      return;
    }

    this.vectorEnabled = await this.tryEnableVector();

    await this.pool.query(DDL);

    await this.ensureTagsIndexed();
    if (this.vectorEnabled) this.vectorDims = await this.readVectorDims();
    await this.writeMeta();
  }

  async readMeta(): Promise<{
    version: number;
    vectorEnabled: boolean;
    vectorDims: number | null;
  } | null> {
    return metaOps.readMeta(this.pool);
  }

  async writeMeta(): Promise<void> {
    return metaOps.writeMeta(this.pool, this.vectorEnabled, this.vectorDims);
  }

  async ensureTagsIndexed(): Promise<void> {
    return metaOps.ensureTagsIndexed(this.pool);
  }

  async readVectorDims(): Promise<number | null> {
    return metaOps.readVectorDims(this.pool);
  }

  private async ensureVectorColumn(dims: number): Promise<boolean> {
    if (!this.vectorEnabled) return false;
    if (!Number.isInteger(dims) || dims < 1 || dims > 16000) return false;

    if (this.vectorDims === null) {
      await this.pool.query(
        `ALTER TABLE observations ADD COLUMN IF NOT EXISTS embedding vector(${dims})`,
      );
      await this.pool.query(
        `CREATE INDEX IF NOT EXISTS idx_obs_embedding
           ON observations USING hnsw (embedding vector_cosine_ops)`,
      );
      this.vectorDims = await this.readVectorDims();
      await this.writeMeta();
    }

    if (this.vectorDims !== dims && !this.warnedDims) {
      this.warnedDims = true;
      process.stderr.write(
        `[claude-db] embeddings are ${dims}d but this database stores ` +
          `${this.vectorDims}d; storing text only. Keyword search is unaffected.\n`,
      );
    }
    return this.vectorDims === dims;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async ping(): Promise<boolean> {
    const res = await this.pool.query('SELECT 1 AS ok');
    return res.rowCount === 1;
  }

  async upsertSession(session: Session): Promise<void> {
    return sessionsOps.upsertSession(this.pool, session);
  }

  async getSession(id: string): Promise<Session | null> {
    return sessionsOps.getSession(this.pool, id);
  }

  async recentSessions(project: string, limit: number): Promise<Session[]> {
    return sessionsOps.recentSessions(this.pool, project, limit);
  }

  async insertObservations(observations: Observation[]): Promise<void> {
    return insertOps.insertObservations(
      this.pool,
      (dims) => this.ensureVectorColumn(dims),
      observations,
    );
  }

  async getObservations(ids: string[]): Promise<Observation[]> {
    return observationsOps.getObservations(this.pool, ids);
  }

  async remove(filter: RemoveFilter): Promise<number> {
    return observationsOps.remove(this.pool, filter);
  }

  async list(filter: ListFilter): Promise<Observation[]> {
    return observationsOps.list(this.pool, filter);
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return observationsOps.listProjects(this.pool);
  }

  async inventory(): Promise<string[]> {
    return observationsOps.inventory(this.pool);
  }

  async searchKeyword(query: SearchQuery): Promise<ObservationIndexEntry[]> {
    return searchOps.searchKeyword(this.pool, query);
  }

  async searchVector(vector: number[], query: SearchQuery): Promise<ObservationIndexEntry[]> {
    return vectorSearchOps.searchVector(
      this.pool,
      this.vectorEnabled,
      this.vectorDims,
      vector,
      query,
    );
  }

  async closeObservations(ids: string[]): Promise<number> {
    return observationsOps.closeObservations(this.pool, ids);
  }

  async timeline(query: TimelineQuery): Promise<ObservationIndexEntry[]> {
    return observationsOps.timeline(this.pool, query);
  }

  async tryEnableVector(): Promise<boolean> {
    return metaOps.tryEnableVector(this.pool);
  }

  async upsertGraph(scan: {
    symbols: CodeSymbol[];
    edges: CodeEdge[];
    files: ScannedFile[];
  }): Promise<void> {
    return graphOps.upsertGraph(this.pool, scan);
  }

  async findSymbols(filter: SymbolFilter): Promise<CodeSymbol[]> {
    return graphOps.findSymbols(this.pool, filter);
  }

  async findEdges(filter: EdgeFilter): Promise<CodeEdge[]> {
    return graphOps.findEdges(this.pool, filter);
  }

  async scannedFiles(project: string): Promise<ScannedFile[]> {
    return graphOps.scannedFiles(this.pool, project);
  }

  async removeGraph(project: string, files?: string[]): Promise<number> {
    return graphOps.removeGraph(this.pool, project, files);
  }
}
