import { posix } from 'node:path';
import type { ModuleResolver } from '../system.js';
import { packageResolver } from './package-resolver.js';
import { workspaceResolver } from './workspace-resolver.js';

const SCRIPT_SUFFIX = /\.[cm]?jsx?$/;
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

function probe(base: string, files: ReadonlySet<string>): string | null {
  const stem = base.replace(SCRIPT_SUFFIX, '');
  const candidates = [
    base,
    ...EXTENSIONS.flatMap((ext) => [`${stem}${ext}`, `${stem}/index${ext}`]),
  ];
  return candidates.find((candidate) => files.has(candidate)) ?? null;
}

export function ecmascriptResolver(root: string, files: ReadonlySet<string>): ModuleResolver {
  const packages = packageResolver(root, files);
  const workspaces = workspaceResolver(root, files, (base) => probe(base, files));
  return {
    resolve: (from, specifier) =>
      specifier.startsWith('.')
        ? probe(posix.normalize(posix.join(posix.dirname(from), specifier)), files)
        : (packages(from, specifier) ?? workspaces(from, specifier)),
  };
}
