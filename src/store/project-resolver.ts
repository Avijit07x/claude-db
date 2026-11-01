import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { projectKey } from '../util/project-key.js';
import type { MemoryStore } from './adapter.js';
import { isLinkable, orderScope } from './project-scope.js';

export interface ScopeResolverOptions {
  store: Pick<MemoryStore, 'linkProject' | 'projectScope'>;
  remote: string;
  isFolder?: (value: string) => boolean;
  keyOf?: (folder: string, remote: string) => string;
  scopeTtlMs?: number;
  now?: () => number;
}

export interface ProjectScope {
  key: string;
  names: string[];
}

export interface ScopeResolver {
  key(value: string): Promise<string>;
  resolve(value: string): Promise<ProjectScope>;
}

const SCOPE_TTL_MS = 60_000;

export function isExistingFolder(value: string): boolean {
  if (!isAbsolute(value)) return false;
  try {
    return statSync(value, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}

interface CachedScope {
  at: number;
  scope: Promise<ProjectScope>;
}

export function createScopeResolver(options: ScopeResolverOptions): ScopeResolver {
  const {
    store,
    remote,
    isFolder = isExistingFolder,
    keyOf = (folder, name) => projectKey(folder, { remote: name }),
    scopeTtlMs = SCOPE_TTL_MS,
    now = Date.now,
  } = options;
  const scopes = new Map<string, CachedScope>();

  function forgetOthers(folder: string): void {
    for (const cached of [...scopes.keys()]) if (cached !== folder) scopes.delete(cached);
  }

  async function linked(folder: string): Promise<string[] | null> {
    try {
      return await store.projectScope(folder);
    } catch {
      return null;
    }
  }

  async function lookUp(folder: string): Promise<ProjectScope> {
    const key = keyOf(folder, remote);
    let related = await linked(folder);
    if (isLinkable(folder, key) && !related?.includes(key)) {
      const before = related;
      related = await store.linkProject(folder, key).then(
        () => {
          forgetOthers(folder);
          return linked(folder);
        },
        () => before,
      );
    }
    return { key, names: orderScope(folder, [...(related ?? []), key]) };
  }

  function scopeOf(folder: string): Promise<ProjectScope> {
    const cached = scopes.get(folder);
    if (cached && now() - cached.at < scopeTtlMs) return cached.scope;
    const scope = lookUp(folder);
    scopes.set(folder, { at: now(), scope });
    return scope;
  }

  return {
    async key(value) {
      return isFolder(value) ? (await scopeOf(value)).key : value;
    },

    async resolve(value) {
      return isFolder(value) ? scopeOf(value) : { key: value, names: [value] };
    },
  };
}
