/**
 * Structural types for the bits of `pg` this adapter uses.
 *
 * Declared locally rather than imported so the package typechecks and builds
 * without `pg` or `@types/pg` present. Users who never touch Postgres should
 * not have to install a driver to compile the project.
 */
interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number | null;
}

interface PoolClient {
  query(sql: string, values?: unknown[]): Promise<QueryResult>;
  release(): void;
}

interface Pool {
  query(sql: string, values?: unknown[]): Promise<QueryResult>;
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
}

interface PgModule {
  Pool: new (config: { connectionString: string }) => Pool;
}
import type { MemoryStore, ProjectSummary } from '../adapter.js';
import { isWholeScope } from '../adapter.js';
import { partitionIds } from '../../util/shortid.js';
import type {
  ListFilter,
  Observation,
  ObservationIndexEntry,
  ObservationKind,
  RemoveFilter,
  SearchQuery,
  Session,
  TimelineQuery,
} from '../../types.js';

/**
 * Postgres backend. Uses tsvector for keyword search, and pgvector for
 * embeddings when the extension is available. If `CREATE EXTENSION vector`
 * is not permitted (common on locked-down managed instances) the store still
 * works, minus semantic recall, which the search service handles gracefully.
 */
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
    this.vectorEnabled = await this.tryEnableVector();

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id         TEXT PRIMARY KEY,
        project    TEXT   NOT NULL,
        started_at BIGINT NOT NULL,
        ended_at   BIGINT,
        summary    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_project
        ON sessions(project, started_at DESC);

      CREATE TABLE IF NOT EXISTS observations (
        id         TEXT PRIMARY KEY,
        session_id TEXT   NOT NULL,
        project    TEXT   NOT NULL,
        kind       TEXT   NOT NULL,
        title      TEXT   NOT NULL,
        body       TEXT   NOT NULL,
        files      JSONB  NOT NULL DEFAULT '[]'::jsonb,
        tags       JSONB  NOT NULL DEFAULT '[]'::jsonb,
        created_at BIGINT NOT NULL,
        embedder   TEXT,
        author     TEXT,
        tsv        TSVECTOR GENERATED ALWAYS AS (
          setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(body,  '')), 'B')
        ) STORED
      );
      CREATE INDEX IF NOT EXISTS idx_obs_tsv ON observations USING GIN(tsv);
      CREATE INDEX IF NOT EXISTS idx_obs_project_time
        ON observations(project, created_at DESC);

      ALTER TABLE observations ADD COLUMN IF NOT EXISTS embedder TEXT;
      ALTER TABLE observations ADD COLUMN IF NOT EXISTS author   TEXT;
    `);

    if (this.vectorEnabled) this.vectorDims = await this.readVectorDims();
  }

  private async readVectorDims(): Promise<number | null> {
    const res = await this.pool.query(
      `SELECT atttypmod AS dims FROM pg_attribute
       WHERE attrelid = 'observations'::regclass
         AND attname = 'embedding' AND NOT attisdropped`,
    );
    const dims = Number(res.rows[0]?.['dims'] ?? -1);
    return dims > 0 ? dims : null;
  }

  /**
   * Creates the embedding column sized to the vectors actually being stored,
   * since pgvector needs a fixed width but the width belongs to the embedder:
   * 256 for the builtin, 384 for MiniLM. Hardcoding 384 meant every insert on
   * a default install failed on a dimension mismatch and captured nothing.
   * Returns false when this width cannot be stored, and the caller keeps the
   * observation without a vector rather than losing it. `dims` is bounded
   * above because DDL cannot be parameterised.
   */
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
      this.vectorDims = dims;
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
    await this.pool.query(
      `INSERT INTO sessions (id, project, started_at, ended_at, summary)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         project  = EXCLUDED.project,
         ended_at = COALESCE(EXCLUDED.ended_at, sessions.ended_at),
         summary  = COALESCE(EXCLUDED.summary,  sessions.summary)`,
      [
        session.id,
        session.project,
        session.startedAt,
        session.endedAt ?? null,
        session.summary ?? null,
      ],
    );
  }

  async getSession(id: string): Promise<Session | null> {
    const res = await this.pool.query('SELECT * FROM sessions WHERE id = $1', [id]);
    const row = res.rows[0];
    return row ? toSession(row) : null;
  }

  async recentSessions(project: string, limit: number): Promise<Session[]> {
    const res = await this.pool.query(
      `SELECT * FROM sessions
       WHERE project = $1 AND summary IS NOT NULL
       ORDER BY started_at DESC LIMIT $2`,
      [project, limit],
    );
    return res.rows.map(toSession);
  }

  async insertObservations(observations: Observation[]): Promise<void> {
    if (observations.length === 0) return;

    const width = observations.find((obs) => obs.embedding?.length)?.embedding?.length;
    const vectors = width !== undefined && (await this.ensureVectorColumn(width));

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const obs of observations) {
        const columns = [
          'id', 'session_id', 'project', 'kind', 'title', 'body',
          'files', 'tags', 'created_at', 'embedder', 'author',
        ];
        const values: unknown[] = [
          obs.id, obs.sessionId, obs.project, obs.kind, obs.title, obs.body,
          JSON.stringify(obs.files), JSON.stringify(obs.tags), obs.createdAt,
          obs.embedder ?? null, obs.author ?? null,
        ];
        if (vectors && obs.embedding?.length === width) {
          columns.push('embedding');
          values.push(`[${obs.embedding.join(',')}]`);
        }
        const holes = values.map((_, i) => `$${i + 1}`).join(', ');
        const updates = columns
          .slice(1)
          .map((column) => `${column} = EXCLUDED.${column}`)
          .join(', ');
        await client.query(
          `INSERT INTO observations (${columns.join(', ')}) VALUES (${holes})
           ON CONFLICT (id) DO UPDATE SET ${updates}`,
          values,
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getObservations(ids: string[]): Promise<Observation[]> {
    if (ids.length === 0) return [];
    const { exact, prefixes } = partitionIds(ids);

    const clauses: string[] = [];
    const values: unknown[] = [];

    if (exact.length > 0) {
      values.push(exact);
      clauses.push(`id = ANY($${values.length}::text[])`);
    }
    for (const prefix of prefixes) {
      // Left-anchored LIKE uses the btree index on the text primary key.
      values.push(`${prefix.replace(/[%_]/g, '')}%`);
      clauses.push(`id LIKE $${values.length}`);
    }

    const res = await this.pool.query(
      `SELECT * FROM observations WHERE ${clauses.join(' OR ')}`,
      values,
    );
    return res.rows.map(toObservation);
  }

  async remove(filter: RemoveFilter): Promise<number> {
    if (filter.ids?.length === 0) return 0;

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter.ids) {
      const { exact, prefixes } = partitionIds(filter.ids);
      const alternatives: string[] = [];
      if (exact.length > 0) {
        values.push(exact);
        alternatives.push(`id = ANY($${values.length}::text[])`);
      }
      for (const prefix of prefixes) {
        values.push(`${prefix.replace(/[%_]/g, '')}%`);
        alternatives.push(`id LIKE $${values.length}`);
      }
      conditions.push(`(${alternatives.join(' OR ')})`);
    }
    if (filter.project) {
      values.push(filter.project);
      conditions.push(`project = $${values.length}`);
    }
    if (filter.kind) {
      values.push(filter.kind);
      conditions.push(`kind = $${values.length}`);
    }
    if (filter.before !== undefined) {
      values.push(filter.before);
      conditions.push(`created_at < $${values.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const counted = await client.query(
        `SELECT COUNT(*)::int AS n FROM observations ${where}`,
        values,
      );
      await client.query(`DELETE FROM observations ${where}`, values);
      if (isWholeScope(filter)) {
        await client.query(
          `DELETE FROM sessions ${filter.project ? 'WHERE project = $1' : ''}`,
          filter.project ? [filter.project] : [],
        );
      }
      await client.query('COMMIT');
      return Number(counted.rows[0]?.['n'] ?? 0);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async list(filter: ListFilter): Promise<Observation[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter.project) {
      values.push(filter.project);
      conditions.push(`project = $${values.length}`);
    }
    if (filter.kind) {
      values.push(filter.kind);
      conditions.push(`kind = $${values.length}`);
    }
    if (filter.after !== undefined) {
      values.push(filter.after);
      conditions.push(`created_at > $${values.length}`);
    }
    values.push(filter.limit ?? 1000);

    const res = await this.pool.query(
      `SELECT * FROM observations
       ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY created_at ASC LIMIT $${values.length}`,
      values,
    );
    return res.rows.map(toObservation);
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const res = await this.pool.query(
      `SELECT project, COUNT(*)::int AS n, MAX(created_at) AS last
       FROM observations GROUP BY project ORDER BY last DESC`,
    );
    return res.rows.map((row) => ({
      project: row['project'] as string,
      observations: Number(row['n']),
      lastActive: Number(row['last']),
    }));
  }

  async searchKeyword(query: SearchQuery): Promise<ObservationIndexEntry[]> {
    const conditions = ['tsv @@ plainto_tsquery($1)'];
    const values: unknown[] = [query.text];
    this.appendScope(query, conditions, values);
    values.push(query.limit);

    const res = await this.pool.query(
      `SELECT id, kind, title, project, created_at,
              ts_rank(tsv, plainto_tsquery($1)) AS score
       FROM observations
       WHERE ${conditions.join(' AND ')}
       ORDER BY score DESC
       LIMIT $${values.length}`,
      values,
    );
    return res.rows.map(toIndexEntry);
  }

  async searchVector(
    vector: number[],
    query: SearchQuery,
  ): Promise<ObservationIndexEntry[]> {
    if (!this.vectorEnabled || this.vectorDims !== vector.length) return [];

    const conditions = ['embedding IS NOT NULL'];
    const values: unknown[] = [`[${vector.join(',')}]`];
    this.appendScope(query, conditions, values);

    if (query.embedder) {
      values.push(query.embedder);
      conditions.push(`(embedder = $${values.length} OR embedder IS NULL)`);
    }
    values.push(query.limit);

    const res = await this.pool.query(
      `SELECT id, kind, title, project, created_at,
              1 - (embedding <=> $1::vector) AS score
       FROM observations
       WHERE ${conditions.join(' AND ')}
       ORDER BY embedding <=> $1::vector
       LIMIT $${values.length}`,
      values,
    );
    return res.rows.map(toIndexEntry);
  }

  async timeline(query: TimelineQuery): Promise<ObservationIndexEntry[]> {
    const anchorRes = await this.pool.query(
      'SELECT project, created_at FROM observations WHERE id = $1',
      [query.observationId],
    );
    const anchor = anchorRes.rows[0];
    if (!anchor) return [];

    const res = await this.pool.query(
      `(SELECT id, kind, title, project, created_at, 0 AS score
        FROM observations
        WHERE project = $1 AND created_at <= $2
        ORDER BY created_at DESC LIMIT $3)
       UNION
       (SELECT id, kind, title, project, created_at, 0 AS score
        FROM observations
        WHERE project = $1 AND created_at > $2
        ORDER BY created_at ASC LIMIT $4)
       ORDER BY created_at ASC`,
      [anchor.project, anchor.created_at, query.before + 1, query.after],
    );
    return res.rows.map(toIndexEntry);
  }

  private appendScope(
    query: SearchQuery,
    conditions: string[],
    values: unknown[],
  ): void {
    if (query.project) {
      values.push(query.project);
      conditions.push(`project = $${values.length}`);
    }
    if (query.kind) {
      values.push(query.kind);
      conditions.push(`kind = $${values.length}`);
    }
    if (query.since !== undefined) {
      values.push(query.since);
      conditions.push(`created_at >= $${values.length}`);
    }
    if (query.until !== undefined) {
      values.push(query.until);
      conditions.push(`created_at <= $${values.length}`);
    }
  }

  private async tryEnableVector(): Promise<boolean> {
    try {
      await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector');
      return true;
    } catch {
      return false;
    }
  }
}

async function importPg(): Promise<PgModule> {
  try {
    // Bypasses TypeScript's static resolution: `pg` is an optional peer and
    // may legitimately be absent at build time.
    const mod = (await import(/* @vite-ignore */ 'pg' as string)) as unknown as {
      default?: PgModule;
      Pool?: PgModule['Pool'];
    };
    // pg is CommonJS; under NodeNext it may or may not arrive default-wrapped.
    if (mod.default?.Pool) return mod.default;
    if (mod.Pool) return { Pool: mod.Pool };
    throw new Error('unexpected pg module shape');
  } catch {
    throw new Error('Postgres driver not installed. Run: npm install pg');
  }
}

function toSession(row: Record<string, unknown>): Session {
  const session: Session = {
    id: row['id'] as string,
    project: row['project'] as string,
    startedAt: Number(row['started_at']),
  };
  if (row['ended_at'] != null) session.endedAt = Number(row['ended_at']);
  if (row['summary'] != null) session.summary = row['summary'] as string;
  return session;
}

function toObservation(row: Record<string, unknown>): Observation {
  const obs: Observation = {
    id: row['id'] as string,
    sessionId: row['session_id'] as string,
    project: row['project'] as string,
    kind: row['kind'] as ObservationKind,
    title: row['title'] as string,
    body: row['body'] as string,
    files: (row['files'] as string[]) ?? [],
    tags: (row['tags'] as string[]) ?? [],
    createdAt: Number(row['created_at']),
  };
  if (row['embedder'] != null) obs.embedder = row['embedder'] as string;
  if (row['author'] != null) obs.author = row['author'] as string;
  return obs;
}

function toIndexEntry(row: Record<string, unknown>): ObservationIndexEntry {
  return {
    id: row['id'] as string,
    kind: row['kind'] as ObservationKind,
    title: row['title'] as string,
    project: row['project'] as string,
    createdAt: Number(row['created_at']),
    score: Number(row['score'] ?? 0),
  };
}
