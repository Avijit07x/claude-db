import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MemoryStore, ProjectSummary } from '../adapter.js';
import { isWholeScope } from '../adapter.js';
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
import { cosine, packVector, unpackVector } from '../../util/vector.js';
import { scopeToken } from '../../util/scope.js';
import { partitionIds } from '../../util/shortid.js';

const HERE = dirname(fileURLToPath(import.meta.url));

type Row = Record<string, unknown>;

/**
 * Zero-config default backend, built on Node's own `node:sqlite`.
 *
 * Using the builtin rather than better-sqlite3 means no node-gyp, no prebuilt
 * binary to mismatch, and no install step that can fail on a user's machine.
 * Keyword search is FTS5; vectors are scored by exact brute-force cosine,
 * which stays comfortably fast past the ~100k observations one developer
 * accumulates and avoids an approximate index that would need tuning.
 */
export class SqliteStore implements MemoryStore {
  readonly kind = 'sqlite';

  private constructor(private readonly db: DatabaseSync) {}

  static async create(uri: string): Promise<SqliteStore> {
    const path = toFilePath(uri);
    mkdirSync(dirname(path), { recursive: true });
    return new SqliteStore(new DatabaseSync(path));
  }

  async init(): Promise<void> {
    this.db.exec(readFileSync(resolve(HERE, 'schema.sql'), 'utf8'));

    const row = this.db.prepare('PRAGMA user_version').get() as
      | { user_version?: number }
      | undefined;
    const version = Number(row?.['user_version'] ?? 0);

    // Databases written before recursive_triggers was set carry orphaned FTS
    // rows for every re-ingested observation. One rebuild clears them.
    if (version < 1) {
      this.db.exec(`INSERT INTO observations_fts(observations_fts) VALUES('rebuild');`);
    }
    // CREATE TABLE IF NOT EXISTS leaves an existing table alone, so columns
    // added after the fact have to be applied here.
    if (version < 2) {
      for (const column of ['embedder TEXT', 'author TEXT']) {
        try {
          this.db.exec(`ALTER TABLE observations ADD COLUMN ${column}`);
        } catch {
          // Already present, which is the normal case on a fresh database.
        }
      }
    }
    if (version < 2) this.db.exec('PRAGMA user_version = 2');
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async ping(): Promise<boolean> {
    return this.db.prepare('SELECT 1 AS ok').get() !== undefined;
  }

  async upsertSession(session: Session): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO sessions (id, project, started_at, ended_at, summary)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           project  = excluded.project,
           ended_at = COALESCE(excluded.ended_at, sessions.ended_at),
           summary  = COALESCE(excluded.summary,  sessions.summary)`,
      )
      .run(
        session.id,
        session.project,
        session.startedAt,
        session.endedAt ?? null,
        session.summary ?? null,
      );
  }

  async getSession(id: string): Promise<Session | null> {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
      | Row
      | undefined;
    return row ? toSession(row) : null;
  }

  async recentSessions(project: string, limit: number): Promise<Session[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM sessions
         WHERE project = ? AND summary IS NOT NULL
         ORDER BY started_at DESC LIMIT ?`,
      )
      .all(project, limit) as Row[];
    return rows.map(toSession);
  }

  async insertObservations(observations: Observation[]): Promise<void> {
    if (observations.length === 0) return;

    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO observations
        (id, session_id, project, scope, kind, title, body, files, tags,
         created_at, embedding, embedder, author)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    this.db.exec('BEGIN');
    try {
      for (const obs of observations) {
        stmt.run(
          obs.id,
          obs.sessionId,
          obs.project,
          scopeToken(obs.project),
          obs.kind,
          obs.title,
          obs.body,
          JSON.stringify(obs.files),
          JSON.stringify(obs.tags),
          obs.createdAt,
          obs.embedding ? packVector(obs.embedding) : null,
          obs.embedder ?? null,
          obs.author ?? null,
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async getObservations(ids: string[]): Promise<Observation[]> {
    if (ids.length === 0) return [];
    const { exact, prefixes } = partitionIds(ids);

    const clauses: string[] = [];
    const params: unknown[] = [];

    if (exact.length > 0) {
      clauses.push(`id IN (${exact.map(() => '?').join(',')})`);
      params.push(...exact);
    }
    // GLOB with a trailing star is prefix-anchored, so SQLite can serve it
    // from the primary key index rather than scanning.
    for (const prefix of prefixes) {
      clauses.push('id GLOB ?');
      params.push(`${prefix}*`);
    }

    const rows = this.db
      .prepare(`SELECT * FROM observations WHERE ${clauses.join(' OR ')}`)
      .all(...(params as never[])) as Row[];
    return rows.map(toObservation);
  }

  async remove(filter: RemoveFilter): Promise<number> {
    if (filter.ids?.length === 0) return 0;

    const { where, params } = removeWhere(filter);
    const wipe = isWholeScope(filter);

    const count = this.db
      .prepare(`SELECT COUNT(*) AS n FROM observations ${where}`)
      .get(...(params as never[])) as { n: number } | undefined;

    this.db.exec('BEGIN');
    try {
      // The FTS mirror is kept in sync by triggers, so deleting rows here is
      // enough; dropping it manually would desynchronise the two.
      this.db.prepare(`DELETE FROM observations ${where}`).run(...(params as never[]));
      if (wipe) {
        const scope = filter.project ? 'WHERE project = ?' : '';
        this.db
          .prepare(`DELETE FROM sessions ${scope}`)
          .run(...((filter.project ? [filter.project] : []) as never[]));
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    // Only worth the rewrite when a whole scope went; forgetting one row does
    // not justify rebuilding the file.
    if (wipe) this.db.exec('VACUUM');
    return count?.n ?? 0;
  }

  async list(filter: ListFilter): Promise<Observation[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.project) {
      conditions.push('project = ?');
      params.push(filter.project);
    }
    if (filter.kind) {
      conditions.push('kind = ?');
      params.push(filter.kind);
    }
    if (filter.after !== undefined) {
      conditions.push('created_at > ?');
      params.push(filter.after);
    }
    params.push(filter.limit ?? 1000);

    const rows = this.db
      .prepare(
        `SELECT * FROM observations
         ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
         ORDER BY created_at ASC LIMIT ?`,
      )
      .all(...(params as never[])) as Row[];
    return rows.map(toObservation);
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const rows = this.db
      .prepare(
        `SELECT project, COUNT(*) AS n, MAX(created_at) AS last
         FROM observations GROUP BY project ORDER BY last DESC`,
      )
      .all() as Row[];

    return rows.map((row) => ({
      project: row['project'] as string,
      observations: Number(row['n']),
      lastActive: Number(row['last']),
    }));
  }

  async searchKeyword(query: SearchQuery): Promise<ObservationIndexEntry[]> {
    // The project constraint goes inside the MATCH expression, not the WHERE
    // clause. Filtering after the match makes FTS5 rank every project's
    // documents and discard all but one project's worth of that work.
    const match = toMatchExpression(query.text, query.project);
    if (match === null) return [];

    // Remaining filters are cheap and genuinely post-match.
    const conditions = ['observations_fts MATCH ?'];
    const params: unknown[] = [match];
    if (query.kind) {
      conditions.push('o.kind = ?');
      params.push(query.kind);
    }
    if (query.since !== undefined) {
      conditions.push('o.created_at >= ?');
      params.push(query.since);
    }
    if (query.until !== undefined) {
      conditions.push('o.created_at <= ?');
      params.push(query.until);
    }
    params.push(query.limit);

    // bm25() is lower-is-better, so negate it into a descending score. Column
    // weights (title, body, tags, scope) make a hit in the one-sentence claim
    // outrank the same word buried in a long body; scope carries no weight
    // because it is a filter, not a relevance signal.
    const rows = this.db
      .prepare(
        `SELECT o.id, o.kind, o.title, o.project, o.created_at,
                -bm25(observations_fts, 10.0, 1.0, 5.0, 0.0) AS score
         FROM observations_fts
         JOIN observations o ON o.rowid = observations_fts.rowid
         WHERE ${conditions.join(' AND ')}
         ORDER BY score DESC
         LIMIT ?`,
      )
      .all(...(params as never[])) as Row[];

    return rows.map(toIndexEntry);
  }

  async searchVector(
    vector: number[],
    query: SearchQuery,
  ): Promise<ObservationIndexEntry[]> {
    const conditions = ['embedding IS NOT NULL'];
    const params: unknown[] = [];
    appendScope(query, conditions, params, '');

    // NULL means the row predates the column, and the width check in cosine()
    // still guards it. Anything else is a different embedding space.
    if (query.embedder) {
      conditions.push('(embedder = ? OR embedder IS NULL)');
      params.push(query.embedder);
    }

    // Newest-first with a hard cap. The scan is linear in rows returned, so
    // this is what keeps p95 flat as history grows: recent memory stays
    // semantically searchable and older memory remains reachable by keyword.
    params.push(query.maxScanCandidates ?? 25000);

    const rows = this.db
      .prepare(
        `SELECT id, kind, title, project, created_at, embedding
         FROM observations WHERE ${conditions.join(' AND ')}
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...(params as never[])) as Row[];

    return rows
      .map((row) => ({
        id: row['id'] as string,
        kind: row['kind'] as ObservationKind,
        title: row['title'] as string,
        project: row['project'] as string,
        createdAt: Number(row['created_at']),
        score: row['embedding']
          ? cosine(vector, unpackVector(toBuffer(row['embedding'])))
          : 0,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, query.limit);
  }

  async timeline(query: TimelineQuery): Promise<ObservationIndexEntry[]> {
    const anchor = this.db
      .prepare('SELECT project, created_at FROM observations WHERE id = ?')
      .get(query.observationId) as Row | undefined;
    if (!anchor) return [];

    const rows = this.db
      .prepare(
        `SELECT id, kind, title, project, created_at, 0 AS score FROM (
           SELECT * FROM observations
           WHERE project = ? AND created_at <= ?
           ORDER BY created_at DESC LIMIT ?
         )
         UNION
         SELECT id, kind, title, project, created_at, 0 AS score FROM (
           SELECT * FROM observations
           WHERE project = ? AND created_at > ?
           ORDER BY created_at ASC LIMIT ?
         )
         ORDER BY created_at ASC`,
      )
      .all(
        anchor['project'] as string,
        anchor['created_at'] as number,
        query.before + 1,
        anchor['project'] as string,
        anchor['created_at'] as number,
        query.after,
      ) as Row[];

    return rows.map(toIndexEntry);
  }
}

function removeWhere(filter: RemoveFilter): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.ids) {
    const { exact, prefixes } = partitionIds(filter.ids);
    const alternatives: string[] = [];
    if (exact.length > 0) {
      alternatives.push(`id IN (${exact.map(() => '?').join(',')})`);
      params.push(...exact);
    }
    for (const prefix of prefixes) {
      alternatives.push('id GLOB ?');
      params.push(`${prefix}*`);
    }
    conditions.push(`(${alternatives.join(' OR ')})`);
  }
  if (filter.project) {
    conditions.push('project = ?');
    params.push(filter.project);
  }
  if (filter.kind) {
    conditions.push('kind = ?');
    params.push(filter.kind);
  }
  if (filter.before !== undefined) {
    conditions.push('created_at < ?');
    params.push(filter.before);
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

function appendScope(
  query: SearchQuery,
  conditions: string[],
  params: unknown[],
  prefix: string,
): void {
  if (query.project) {
    conditions.push(`${prefix}project = ?`);
    params.push(query.project);
  }
  if (query.kind) {
    conditions.push(`${prefix}kind = ?`);
    params.push(query.kind);
  }
  if (query.since !== undefined) {
    conditions.push(`${prefix}created_at >= ?`);
    params.push(query.since);
  }
  if (query.until !== undefined) {
    conditions.push(`${prefix}created_at <= ?`);
    params.push(query.until);
  }
}

function toFilePath(uri: string): string {
  if (!uri || uri.trim() === '') {
    return resolve(process.env['HOME'] ?? '.', '.claude-memory/memory.db');
  }
  const stripped = uri.replace(/^(sqlite|file):\/\//, '');
  return resolve(stripped === '' ? './memory.db' : stripped);
}

/**
 * Builds the FTS5 MATCH expression.
 *
 * FTS5 treats punctuation as query syntax, so raw user text can throw: every
 * token is quoted. Terms are OR'd so recall stays forgiving and bm25 sorts out
 * what actually mattered, but the whole disjunction is AND'd with the project
 * scope token so the engine never walks other projects' postings.
 *
 * Returns null when there is nothing searchable, so the caller can skip the
 * query entirely rather than issue one that matches everything.
 */
function toMatchExpression(text: string, project?: string): string | null {
  // ponytail: unicode61 keeps a run of Han characters as one token, so CJK
  // matches phrases but not substrings. Vector recall covers the gap; swap in
  // an ICU or bigram tokenizer if that stops being enough.
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((token) => token.length > 1);

  const scope = project ? `scope:${scopeToken(project)}` : null;

  if (tokens.length === 0) return scope;

  const terms = tokens.map((token) => `"${token}"`).join(' OR ');
  return scope ? `${scope} AND (${terms})` : terms;
}

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return Buffer.alloc(0);
}

function toSession(row: Row): Session {
  const session: Session = {
    id: row['id'] as string,
    project: row['project'] as string,
    startedAt: Number(row['started_at']),
  };
  if (row['ended_at'] != null) session.endedAt = Number(row['ended_at']);
  if (row['summary'] != null) session.summary = row['summary'] as string;
  return session;
}

function toObservation(row: Row): Observation {
  const obs: Observation = {
    id: row['id'] as string,
    sessionId: row['session_id'] as string,
    project: row['project'] as string,
    kind: row['kind'] as ObservationKind,
    title: row['title'] as string,
    body: row['body'] as string,
    files: JSON.parse((row['files'] as string) ?? '[]') as string[],
    tags: JSON.parse((row['tags'] as string) ?? '[]') as string[],
    createdAt: Number(row['created_at']),
  };
  if (row['embedding']) obs.embedding = unpackVector(toBuffer(row['embedding']));
  if (row['embedder'] != null) obs.embedder = row['embedder'] as string;
  if (row['author'] != null) obs.author = row['author'] as string;
  return obs;
}

function toIndexEntry(row: Row): ObservationIndexEntry {
  return {
    id: row['id'] as string,
    kind: row['kind'] as ObservationKind,
    title: row['title'] as string,
    project: row['project'] as string,
    createdAt: Number(row['created_at']),
    score: Number(row['score'] ?? 0),
  };
}
