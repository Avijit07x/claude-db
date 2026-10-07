import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, sep } from 'node:path';
import type { ModuleResolver } from '../system.js';

type Resolve = ModuleResolver['resolve'];

interface Factory {
  resolveFileSync(file: string, request: string): { path?: string };
}

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const EXTENSION_ALIAS = {
  '.js': ['.ts', '.tsx', '.js'],
  '.mjs': ['.mts', '.mjs'],
  '.cjs': ['.cts', '.cjs'],
};
const CONDITIONS = ['import', 'require', 'node', 'default', 'types'];
const TSCONFIG = /(^|\/)tsconfig[^/]*\.json$/;
const CUSTOM_CONDITIONS = /"customConditions"\s*:\s*\[([^\]]*)\]/g;
const QUOTED = /"([^"]+)"/g;

function customConditions(root: string, files: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  for (const path of files) {
    if (!TSCONFIG.test(path)) continue;
    try {
      const text = readFileSync(join(root, path), 'utf8');
      for (const list of text.matchAll(CUSTOM_CONDITIONS)) {
        for (const name of (list[1] ?? '').matchAll(QUOTED)) found.add(name[1] ?? '');
      }
    } catch {
      continue;
    }
  }
  found.delete('');
  return [...found];
}

function loadFactory(conditions: string[]): Factory | null {
  try {
    const { ResolverFactory } = createRequire(import.meta.url)('oxc-resolver') as {
      ResolverFactory: new (options: object) => Factory;
    };
    return new ResolverFactory({
      extensions: EXTENSIONS,
      extensionAlias: EXTENSION_ALIAS,
      conditionNames: [...conditions, ...CONDITIONS],
      mainFields: ['module', 'main'],
      tsconfig: 'auto',
    });
  } catch {
    return null;
  }
}

function realRoot(root: string): string {
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
}

export function packageResolver(root: string, files: ReadonlySet<string>): Resolve {
  const factory = loadFactory(customConditions(root, files));
  if (!factory) return () => null;
  const base = realRoot(root);

  return (from, specifier) => {
    try {
      const { path } = factory.resolveFileSync(join(base, from), specifier);
      if (!path) return null;
      const found = relative(base, path).split(sep).join('/');
      return files.has(found) ? found : null;
    } catch {
      return null;
    }
  };
}
