import type { Collection, Db, Doc, MongoClient } from './driver.js';
import { importMongo } from './driver.js';
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
import { cosine } from '../../util/vector.js';
import { partitionIds } from '../../util/shortid.js';

interface SessionDoc extends Doc {
  _id: string;
  project: string;
  startedAt: number;
  endedAt?: number;
  summary?: string;
}

interface ObservationDoc extends Doc {
  _id: string;
  sessionId: string;
  project: string;
  kind: ObservationKind;
  title: string;
  body: string;
  files: string[];
  tags: string[];
  createdAt: number;
  embedding?: number[];
  embedder?: string;
  author?: string;
}

/**
 * Works against any MongoDB: Atlas, self-hosted, or a local container.
 *
 * Keyword search uses a compound text index, available in every deployment.
 * Vector search prefers an Atlas `$vectorSearch` index when one exists and
 * otherwise falls back to scoring candidates in process, so a plain
 * `mongodb://localhost` connection string still gets semantic recall.
 */
export class MongoStore implements MemoryStore {
  readonly kind = 'mongodb';

  /** Resolved on first vector query, then cached for the process lifetime. */
  private atlasVectorIndex: boolean | null = null;

  private constructor(
    private readonly client: MongoClient,
    private readonly db: Db,
    private readonly sessions: Collection<SessionDoc>,
    private readonly observations: Collection<ObservationDoc>,
  ) {}

  static async create(uri: string): Promise<MongoStore> {
    const mongo = await importMongo();
    const client = new mongo.MongoClient(uri);
    await client.connect();
    // Honour a database name in the URI, fall back to a sensible default.
    const db = client.db(databaseNameFrom(uri) ?? 'claude_memory_db');
    return new MongoStore(
      client,
      db,
      db.collection<SessionDoc>('sessions'),
      db.collection<ObservationDoc>('observations'),
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
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async ping(): Promise<boolean> {
    const res = await this.db.command({ ping: 1 });
    return res['ok'] === 1;
  }

  async upsertSession(session: Session): Promise<void> {
    const set: Partial<SessionDoc> = {
      project: session.project,
      startedAt: session.startedAt,
    };
    if (session.endedAt !== undefined) set.endedAt = session.endedAt;
    if (session.summary !== undefined) set.summary = session.summary;

    await this.sessions.updateOne(
      { _id: session.id },
      { $set: set },
      { upsert: true },
    );
  }

  async getSession(id: string): Promise<Session | null> {
    const doc = await this.sessions.findOne({ _id: id });
    return doc ? toSession(doc) : null;
  }

  async recentSessions(project: string, limit: number): Promise<Session[]> {
    const docs = await this.sessions
      .find({ project, summary: { $type: 'string' } })
      .sort({ startedAt: -1 })
      .limit(limit)
      .toArray();
    return docs.map(toSession);
  }

  async insertObservations(observations: Observation[]): Promise<void> {
    if (observations.length === 0) return;
    await this.observations.bulkWrite(
      observations.map((obs) => ({
        replaceOne: {
          filter: { _id: obs.id },
          replacement: toDoc(obs),
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  async getObservations(ids: string[]): Promise<Observation[]> {
    if (ids.length === 0) return [];
    const { exact, prefixes } = partitionIds(ids);

    const or: Record<string, unknown>[] = [];
    if (exact.length > 0) or.push({ _id: { $in: exact } });
    for (const prefix of prefixes) {
      // Anchored regex on _id is index-eligible in MongoDB.
      or.push({ _id: { $regex: `^${escapeRegex(prefix)}` } });
    }

    const docs = await this.observations
      .find({ $or: or } as Doc)
      .toArray();
    return docs.map(toObservation);
  }

  async remove(filter: RemoveFilter): Promise<number> {
    if (filter.ids?.length === 0) return 0;

    const query: Record<string, unknown> = {};
    if (filter.project) query['project'] = filter.project;
    if (filter.kind) query['kind'] = filter.kind;
    if (filter.before !== undefined) query['createdAt'] = { $lt: filter.before };

    if (filter.ids) {
      const { exact, prefixes } = partitionIds(filter.ids);
      const alternatives: Record<string, unknown>[] = [];
      if (exact.length > 0) alternatives.push({ _id: { $in: exact } });
      for (const prefix of prefixes) {
        alternatives.push({ _id: { $regex: `^${escapeRegex(prefix)}` } });
      }
      query['$or'] = alternatives;
    }

    const count = await this.observations.countDocuments(query as Doc);
    await this.observations.deleteMany(query as Doc);
    if (isWholeScope(filter)) {
      await this.sessions.deleteMany(filter.project ? { project: filter.project } : {});
    }
    return count;
  }

  async list(filter: ListFilter): Promise<Observation[]> {
    const query: Record<string, unknown> = {};
    if (filter.project) query['project'] = filter.project;
    if (filter.kind) query['kind'] = filter.kind;
    if (filter.after !== undefined) query['createdAt'] = { $gt: filter.after };

    const docs = await this.observations
      .find(query as Doc)
      .sort({ createdAt: 1 })
      .limit(filter.limit ?? 1000)
      .toArray();
    return docs.map(toObservation);
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const rows = await this.observations
      .aggregate<{ _id: string; n: number; last: number }>([
        { $group: { _id: '$project', n: { $sum: 1 }, last: { $max: '$createdAt' } } },
        { $sort: { last: -1 } },
      ])
      .toArray();

    return rows.map((row) => ({
      project: row._id,
      observations: row.n,
      lastActive: row.last,
    }));
  }

  async searchKeyword(query: SearchQuery): Promise<ObservationIndexEntry[]> {
    const filter: Doc = {
      $text: { $search: query.text },
      ...this.scopeFilter(query),
    };

    const docs = await this.observations
      .find(filter, { projection: { score: { $meta: 'textScore' }, body: 0, embedding: 0 } })
      .sort({ score: { $meta: 'textScore' } })
      .limit(query.limit)
      .toArray();

    return docs.map((doc) => toIndexEntry(doc, (doc['score'] as number) ?? 0));
  }

  async searchVector(
    vector: number[],
    query: SearchQuery,
  ): Promise<ObservationIndexEntry[]> {
    if (this.atlasVectorIndex === null) {
      this.atlasVectorIndex = await this.hasAtlasVectorIndex();
    }

    if (this.atlasVectorIndex) {
      const docs = await this.observations
        .aggregate<ObservationDoc & { score: number }>([
          {
            $vectorSearch: {
              index: 'memory_vector',
              path: 'embedding',
              queryVector: vector,
              numCandidates: Math.max(query.limit * 10, 100),
              limit: query.limit,
              filter: this.scopeFilter(query),
            },
          },
          {
            $project: {
              kind: 1, title: 1, project: 1, createdAt: 1,
              score: { $meta: 'vectorSearchScore' },
            },
          },
        ])
        .toArray();
      return docs.map((doc) => toIndexEntry(doc, doc.score));
    }

    // Portable path: score candidates in process. Bounded by the scope filter,
    // which in practice narrows to a single project.
    const docs = await this.observations
      .find(
        {
          embedding: { $exists: true },
          ...(query.embedder
            ? { $or: [{ embedder: query.embedder }, { embedder: { $exists: false } }] }
            : {}),
          ...this.scopeFilter(query),
        },
        { projection: { kind: 1, title: 1, project: 1, createdAt: 1, embedding: 1 } },
      )
      .sort({ createdAt: -1 })
      .limit(query.maxScanCandidates ?? 25000)
      .toArray();

    return docs
      .map((doc) => toIndexEntry(doc, doc.embedding ? cosine(vector, doc.embedding) : 0))
      .sort((a, b) => b.score - a.score)
      .slice(0, query.limit);
  }

  async timeline(query: TimelineQuery): Promise<ObservationIndexEntry[]> {
    const anchor = await this.observations.findOne(
      { _id: query.observationId },
      { projection: { project: 1, createdAt: 1 } },
    );
    if (!anchor) return [];

    const projection = { kind: 1, title: 1, project: 1, createdAt: 1 };

    const [before, after] = await Promise.all([
      this.observations
        .find({ project: anchor.project, createdAt: { $lte: anchor.createdAt } }, { projection })
        .sort({ createdAt: -1 })
        .limit(query.before + 1)
        .toArray(),
      this.observations
        .find({ project: anchor.project, createdAt: { $gt: anchor.createdAt } }, { projection })
        .sort({ createdAt: 1 })
        .limit(query.after)
        .toArray(),
    ]);

    return [...before.reverse(), ...after].map((doc) => toIndexEntry(doc, 0));
  }

  private scopeFilter(query: SearchQuery): Doc {
    const filter: Record<string, unknown> = {};
    if (query.project) filter['project'] = query.project;
    if (query.kind) filter['kind'] = query.kind;
    if (query.since !== undefined || query.until !== undefined) {
      const range: Record<string, number> = {};
      if (query.since !== undefined) range['$gte'] = query.since;
      if (query.until !== undefined) range['$lte'] = query.until;
      filter['createdAt'] = range;
    }
    return filter;
  }

  private async hasAtlasVectorIndex(): Promise<boolean> {
    try {
      const indexes = await this.observations.listSearchIndexes().toArray();
      return indexes.some((index) => index['name'] === 'memory_vector');
    } catch {
      // listSearchIndexes is Atlas-only; anything else means no vector index.
      return false;
    }
  }
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function databaseNameFrom(uri: string): string | null {
  const match = /\/\/[^/]+\/([^?]+)/.exec(uri);
  const name = match?.[1]?.trim();
  return name && name.length > 0 ? name : null;
}

function toSession(doc: SessionDoc): Session {
  const session: Session = {
    id: doc._id,
    project: doc.project,
    startedAt: doc.startedAt,
  };
  if (doc.endedAt !== undefined) session.endedAt = doc.endedAt;
  if (doc.summary !== undefined) session.summary = doc.summary;
  return session;
}

function toDoc(obs: Observation): ObservationDoc {
  const doc: ObservationDoc = {
    _id: obs.id,
    sessionId: obs.sessionId,
    project: obs.project,
    kind: obs.kind,
    title: obs.title,
    body: obs.body,
    files: obs.files,
    tags: obs.tags,
    createdAt: obs.createdAt,
  };
  if (obs.embedding) doc.embedding = obs.embedding;
  if (obs.embedder) doc.embedder = obs.embedder;
  if (obs.author) doc.author = obs.author;
  return doc;
}

function toObservation(doc: ObservationDoc): Observation {
  const obs: Observation = {
    id: doc._id,
    sessionId: doc.sessionId,
    project: doc.project,
    kind: doc.kind,
    title: doc.title,
    body: doc.body,
    files: doc.files ?? [],
    tags: doc.tags ?? [],
    createdAt: doc.createdAt,
  };
  if (doc.embedding) obs.embedding = doc.embedding;
  if (doc.embedder) obs.embedder = doc.embedder;
  if (doc.author) obs.author = doc.author;
  return obs;
}

function toIndexEntry(doc: Partial<ObservationDoc>, score: number): ObservationIndexEntry {
  return {
    id: doc._id as string,
    kind: doc.kind as ObservationKind,
    title: doc.title as string,
    project: doc.project as string,
    createdAt: doc.createdAt as number,
    score,
  };
}
