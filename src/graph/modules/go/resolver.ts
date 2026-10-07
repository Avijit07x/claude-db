import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModuleResolver } from '../system.js';

const MODULE_LINE = /^\s*module\s+("?)(\S+?)\1\s*(?:\/\/.*)?$/m;
const ROOT = '.';

interface GoModule {
  path: string;
  dir: string;
}

const dirOf = (file: string): string => {
  const slash = file.lastIndexOf('/');
  return slash < 0 ? ROOT : file.slice(0, slash);
};
const joinDir = (...parts: string[]): string => {
  const kept = parts.filter((part) => part && part !== ROOT);
  return kept.length > 0 ? kept.join('/') : ROOT;
};

function modulesOf(root: string, files: ReadonlySet<string>): GoModule[] {
  const found: GoModule[] = [];
  for (const file of files) {
    if (file !== 'go.mod' && !file.endsWith('/go.mod')) continue;
    try {
      const path = MODULE_LINE.exec(readFileSync(join(root, file), 'utf8'))?.[2];
      if (path) found.push({ path, dir: dirOf(file) });
    } catch {
      continue;
    }
  }
  return found.sort((a, b) => b.path.length - a.path.length);
}

export function goResolver(root: string, files: ReadonlySet<string>): ModuleResolver {
  const modules = modulesOf(root, files);
  const packages = new Set([...files].filter((file) => file.endsWith('.go')).map(dirOf));

  const inside = (module: GoModule, specifier: string): string | null => {
    if (specifier !== module.path && !specifier.startsWith(`${module.path}/`)) return null;
    const dir = joinDir(module.dir, specifier.slice(module.path.length + 1));
    return packages.has(dir) ? dir : null;
  };

  const vendored = (specifier: string): string | null => {
    const dir = joinDir('vendor', specifier);
    return packages.has(dir) ? dir : null;
  };

  return {
    resolve(_from, specifier) {
      for (const module of modules) {
        const found = inside(module, specifier);
        if (found) return found;
      }
      return vendored(specifier);
    },
    foreign: (_from, specifier) => !specifier.startsWith('.'),
    unit: dirOf,
  };
}
