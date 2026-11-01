import type { Embedder } from '../embed/index.js';
import type { MemoryStore } from '../store/adapter.js';
import type { Observation, ObservationIndexEntry, SearchQuery, TimelineQuery } from '../types.js';
import { applyRecencyBoost, fuse } from './rank.js';
import { meaningfulTokens } from './stopwords.js';

export class SearchService {
  constructor(
    private readonly store: MemoryStore,
    private readonly embedder: Embedder | (() => Promise<Embedder>),
    private readonly maxScanCandidates = 25000,
  ) {}

  async search(query: SearchQuery): Promise<ObservationIndexEntry[]> {
    if (meaningfulTokens(query.text).length === 0) return [];

    const wide: SearchQuery = {
      ...query,
      limit: query.limit * 3,
      maxScanCandidates: query.maxScanCandidates ?? this.maxScanCandidates,
    };

    const embedded = this.embed(wide.text);
    const keyword = await this.store.searchKeyword(wide).catch(() => []);
    const vector = await this.vectorSearch(wide, await embedded);

    const fused = fuse(
      [keyword, vector].filter((r) => r.length > 0),
      query.limit,
    );
    return applyRecencyBoost(fused, Date.now());
  }

  private async embed(text: string): Promise<{ embedder: Embedder; embedding: number[] } | null> {
    try {
      const embedder = typeof this.embedder === 'function' ? await this.embedder() : this.embedder;
      if (embedder.dimensions === 0) return null;
      const [embedding] = await embedder.embed([text]);
      return embedding && embedding.length > 0 ? { embedder, embedding } : null;
    } catch {
      return null;
    }
  }

  private async vectorSearch(
    query: SearchQuery,
    embedded: { embedder: Embedder; embedding: number[] } | null,
  ): Promise<ObservationIndexEntry[]> {
    if (!embedded) return [];
    const { embedder, embedding } = embedded;
    try {
      const candidates = await this.store.searchVector(embedding, {
        ...query,
        embedder: embedder.id,
      });
      return candidates.filter((entry) => entry.score >= embedder.minRelevance);
    } catch {
      return [];
    }
  }

  async timeline(query: TimelineQuery): Promise<ObservationIndexEntry[]> {
    const [anchor] = await this.store.getObservations([query.observationId]);
    if (!anchor) return [];
    return this.store.timeline({ ...query, observationId: anchor.id });
  }

  async getObservations(ids: string[]): Promise<Observation[]> {
    return this.store.getObservations(ids);
  }
}
