import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { projectKey } from '../util/project-key.js';
import type { MemoryStore } from './adapter.js';
import { orderScope } from './project-scope.js';

export interface ScopeResolverOptions {
  store: Pick<MemoryStore, 'linkProject' | 'projectScope'>;
  remote: string;
  isFolder?: (value: string) => boolean;
  keyOf?: (folder: string, remote: string) => string;
}

export interface ProjectScope {
  key: string;
  names: string[];
}

export interface ScopeResolver {
  resolve(value: string): Promise<ProjectScope>;
}

export function isExistingFolder(value: string): boolean {
  if (!isAbsolute(value)) return false;
  try {
    return statSync(value, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}

export function createScopeResolver(options: ScopeResolverOptions): ScopeResolver {
  const {
    store,
    remote,
    isFolder = isExistingFolder,
    keyOf = (folder, name) => projectKey(folder, { remote: name }),
  } = options;
  const keys = new Map<string, Promise<string>>();

  async function linkedKey(folder: string): Promise<string> {
    const key = keyOf(folder, remote);
    try {
      await store.linkProject(folder, key);
    } catch {
      return key;
    }
    return key;
  }

  async function namesFor(folder: string, key: string): Promise<string[]> {
    try {
      return orderScope(folder, [...(await store.projectScope(folder)), key]);
    } catch {
      return orderScope(folder, [key]);
    }
  }

  return {
    async resolve(value) {
      if (!isFolder(value)) return { key: value, names: [value] };
      let pending = keys.get(value);
      if (!pending) {
        pending = linkedKey(value);
        keys.set(value, pending);
      }
      const key = await pending;
      return { key, names: await namesFor(value, key) };
    },
  };
}
