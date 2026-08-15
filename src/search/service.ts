import type { Embedder } from '../embed/index.js';
import type { MemoryStore } from '../store/adapter.js';
import type {
  Observation,
  ObservationIndexEntry,
  SearchQuery,
  TimelineQuery,
} from '../types.js';
import { applyRecencyBoost, fuse } from './rank.js';

/**
 * Three-layer progressive disclosure.
 *
 * Naive memory search returns whole records and burns thousands of tokens on
 * results the agent discards. Here retrieval is split so the agent pays for
 * detail only once it has decided what is relevant:
 *
 *   1. search()          compact index, roughly 50-100 tokens per hit
 *   2. timeline()        chronological neighbours of a promising hit
 *   3. getObservations() full bodies, for a hand-picked set of ids
 *
 * Filtering at layer 1 and expanding at layer 3 is where the ~10x saving comes
 * from versus returning full records up front.
 */
export class SearchService {
  constructor(
    private readonly store: MemoryStore,
    /** Lazily resolved: search must not force model construction. */
    private readonly embedder: Embedder | (() => Promise<Embedder>),
    /** Ceiling for brute-force vector scans on backends without an index. */
    private readonly maxScanCandidates = 25000,
  ) {}

  /** Layer 1. Hybrid keyword + vector retrieval, fused by rank. */
  async search(query: SearchQuery): Promise<ObservationIndexEntry[]> {
    // Over-fetch from each retriever so fusion has room to disagree.
    const wide: SearchQuery = {
      ...query,
      limit: query.limit * 3,
      maxScanCandidates: query.maxScanCandidates ?? this.maxScanCandidates,
    };

    const keyword = await this.store.searchKeyword(wide).catch(() => []);
    const vector = await this.vectorSearch(wide);

    const fused = fuse([keyword, vector].filter((r) => r.length > 0), query.limit);
    return applyRecencyBoost(fused, Date.now());
  }

  /**
   * Vector retrieval, isolated so its failure modes cannot take down search.
   *
   * The embedding model may be absent, still downloading, or unsupported by
   * the backend. In every one of those cases the correct behaviour is to
   * return no vector candidates and let keyword results stand, never to throw:
   * degraded recall beats no recall.
   */
  private async vectorSearch(query: SearchQuery): Promise<ObservationIndexEntry[]> {
    try {
      const embedder =
        typeof this.embedder === 'function' ? await this.embedder() : this.embedder;
      if (embedder.dimensions === 0) return [];

      const [embedding] = await embedder.embed([query.text]);
      if (!embedding || embedding.length === 0) return [];

      const candidates = await this.store.searchVector(embedding, {
        ...query,
        embedder: embedder.id,
      });

      // Nearest-neighbour search always returns its top k, however poor the
      // match. Without a floor, an unrelated prompt still yields results, and
      // injecting those trains the reader to ignore memory entirely. Dropping
      // them here rather than after fusion keeps weak candidates from
      // borrowing rank credibility from the keyword list.
      return candidates.filter((entry) => entry.score >= embedder.minRelevance);
    } catch {
      return [];
    }
  }

  /** Layer 2. What was happening around a given observation. */
  async timeline(query: TimelineQuery): Promise<ObservationIndexEntry[]> {
    return this.store.timeline(query);
  }

  /** Layer 3. Full detail, only for ids the caller already filtered down to. */
  async getObservations(ids: string[]): Promise<Observation[]> {
    return this.store.getObservations(ids);
  }
}
