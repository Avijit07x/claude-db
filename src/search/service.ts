import type { Embedder } from '../embed/index.js';
import type { MemoryStore } from '../store/adapter.js';
import type { Observation, ObservationIndexEntry, SearchQuery, TimelineQuery } from '../types.js';
import { applyRecencyBoost, fuse } from './rank.js';

export class SearchService {
  constructor(
    private readonly store: MemoryStore,
    private readonly embedder: Embedder | (() => Promise<Embedder>),
    private readonly maxScanCandidates = 25000,
  ) {}

  async search(query: SearchQuery): Promise<ObservationIndexEntry[]> {
    const wide: SearchQuery = {
      ...query,
      limit: query.limit * 3,
      maxScanCandidates: query.maxScanCandidates ?? this.maxScanCandidates,
    };

    const keyword = await this.store.searchKeyword(wide).catch(() => []);
    const vector = await this.vectorSearch(wide);

    const fused = fuse(
      [keyword, vector].filter((r) => r.length > 0),
      query.limit,
    );
    return applyRecencyBoost(fused, Date.now());
  }

  private async vectorSearch(query: SearchQuery): Promise<ObservationIndexEntry[]> {
    try {
      const embedder = typeof this.embedder === 'function' ? await this.embedder() : this.embedder;
      if (embedder.dimensions === 0) return [];

      const [embedding] = await embedder.embed([query.text]);
      if (!embedding || embedding.length === 0) return [];

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
