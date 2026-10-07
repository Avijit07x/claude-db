import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModuleResolver } from '../system.js';

type Resolve = ModuleResolver['resolve'];
type Probe = (base: string) => string | null;

interface Workspace {
  name: string;
  dir: string;
  entries: string[];
}

const ENTRY_FIELDS = ['source', 'module', 'main', 'types'];
const SOURCE_ROOTS = ['src', ''];

const joinPath = (...parts: string[]): string => parts.filter(Boolean).join('/');
const dirOf = (file: string): string => file.slice(0, Math.max(file.lastIndexOf('/'), 0));

function readPackage(root: string, manifest: string): Workspace | undefined {
  try {
    const json = JSON.parse(readFileSync(join(root, manifest), 'utf8')) as Record<string, unknown>;
    if (typeof json.name !== 'string') return undefined;
    const dir = dirOf(manifest);
    const entries = ENTRY_FIELDS.flatMap((key) =>
      typeof json[key] === 'string' ? [joinPath(dir, json[key].replace(/^\.\//, ''))] : [],
    );
    return { name: json.name, dir, entries };
  } catch {
    return undefined;
  }
}

export function workspaceResolver(root: string, files: ReadonlySet<string>, probe: Probe): Resolve {
  const packages = [...files]
    .filter((file) => file === 'package.json' || file.endsWith('/package.json'))
    .flatMap((manifest) => readPackage(root, manifest) ?? [])
    .sort((a, b) => b.name.length - a.name.length);

  return (_from, specifier) => {
    const found = packages.find(
      (candidate) => specifier === candidate.name || specifier.startsWith(`${candidate.name}/`),
    );
    if (!found) return null;

    const rest = specifier.slice(found.name.length + 1);
    if (rest === '') {
      const declared = found.entries.map((entry) => probe(entry)).find(Boolean);
      const defaults = SOURCE_ROOTS.map((where) => probe(joinPath(found.dir, where, 'index')));
      return declared ?? defaults.find(Boolean) ?? null;
    }
    const subpaths = SOURCE_ROOTS.map((where) => probe(joinPath(found.dir, where, rest)));
    return subpaths.find(Boolean) ?? null;
  };
}
