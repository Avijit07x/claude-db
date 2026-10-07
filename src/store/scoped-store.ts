import type {
  ListFilter,
  Observation,
  ObservationIndexEntry,
  ProjectFilter,
  RemoveFilter,
  SearchQuery,
  Session,
} from '../types.js';
import type { MemoryStore } from './adapter.js';
import type { ScopeResolver } from './project-resolver.js';

type Overrides = Pick<
  MemoryStore,
  | 'insertObservations'
  | 'upsertSession'
  | 'recentSessions'
  | 'remove'
  | 'list'
  | 'searchKeyword'
  | 'searchVector'
>;

export function withProjectScope(inner: MemoryStore, resolver: ScopeResolver): MemoryStore {
  const keyOf = async (project: string): Promise<string> => (await resolver.resolve(project)).key;

  async function expand(filter: ProjectFilter | undefined): Promise<ProjectFilter | undefined> {
    if (filter === undefined) return undefined;
    const values = typeof filter === 'string' ? [filter] : filter;
    const scopes = await Promise.all(values.map((value) => resolver.resolve(value)));
    const names = [...new Set(scopes.flatMap((scope) => scope.names))];
    return typeof filter === 'string' && names.length === 1 ? names[0] : names;
  }

  const overrides: Overrides = {
    async insertObservations(observations: Observation[]): Promise<void> {
      const keyed = await Promise.all(
        observations.map(async (obs) => ({ ...obs, project: await keyOf(obs.project) })),
      );
      return inner.insertObservations(keyed);
    },

    async upsertSession(session: Session): Promise<void> {
      return inner.upsertSession({ ...session, project: await keyOf(session.project) });
    },

    async recentSessions(project: ProjectFilter, limit: number): Promise<Session[]> {
      return inner.recentSessions((await expand(project)) ?? project, limit);
    },

    async remove(filter: RemoveFilter): Promise<number> {
      const project = await expand(filter.project);
      return inner.remove(project === undefined ? filter : { ...filter, project });
    },

    async list(filter: ListFilter): Promise<Observation[]> {
      const project = await expand(filter.project);
      return inner.list(project === undefined ? filter : { ...filter, project });
    },

    async searchKeyword(query: SearchQuery): Promise<ObservationIndexEntry[]> {
      const project = await expand(query.project);
      return inner.searchKeyword(project === undefined ? query : { ...query, project });
    },

    async searchVector(vector: number[], query: SearchQuery): Promise<ObservationIndexEntry[]> {
      const project = await expand(query.project);
      return inner.searchVector(vector, project === undefined ? query : { ...query, project });
    },
  };

  return new Proxy(inner, {
    get(target, property, receiver) {
      if (property in overrides) return overrides[property as keyof Overrides];
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      return (value as (...args: unknown[]) => unknown).bind(target);
    },
  });
}
