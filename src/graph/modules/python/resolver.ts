import type { ModuleResolver } from '../system.js';

const SOURCES = ['.py', '.pyi'];
const PACKAGE_FILES = SOURCES.map((extension) => `__init__${extension}`);
const NAMESPACE_FILE = PACKAGE_FILES[0] ?? '__init__.py';

const join = (...parts: string[]): string => parts.filter(Boolean).join('/');
const parentOf = (path: string): string => path.slice(0, Math.max(path.lastIndexOf('/'), 0));
const isSource = (path: string): boolean => SOURCES.some((extension) => path.endsWith(extension));

function directories(files: ReadonlySet<string>): Set<string> {
  const found = new Set(['']);
  for (const file of files) {
    if (!isSource(file)) continue;
    for (let dir = parentOf(file); dir && !found.has(dir); dir = parentOf(dir)) found.add(dir);
  }
  return found;
}

export function pythonResolver(_root: string, files: ReadonlySet<string>): ModuleResolver {
  const dirs = directories(files);
  const hasPackage = (dir: string): boolean =>
    PACKAGE_FILES.some((name) => files.has(join(dir, name)));

  const regular = (path: string): string | null =>
    [
      ...SOURCES.map((extension) => `${path}${extension}`),
      ...PACKAGE_FILES.map((name) => join(path, name)),
    ].find((candidate) => files.has(candidate)) ?? null;
  const namespace = (path: string): string | null =>
    dirs.has(path) ? join(path, NAMESPACE_FILE) : null;

  const topLevel = new Map<string, Set<string>>();
  for (const file of files) {
    if (!isSource(file)) continue;
    const isPackage = PACKAGE_FILES.some((name) => file.endsWith(`/${name}`));
    const unit = isPackage ? parentOf(file) : file.slice(0, file.lastIndexOf('.'));
    const base = parentOf(unit);
    if (hasPackage(base)) continue;
    const name = unit.slice(base ? base.length + 1 : 0);
    topLevel.set(name, (topLevel.get(name) ?? new Set()).add(base));
  }

  const rootsOf = new Map<string, string[]>();
  const rootsFor = (dir: string): string[] => {
    const cached = rootsOf.get(dir);
    if (cached) return cached;
    const roots = [''];
    for (let up = dir; up; up = parentOf(up)) if (!hasPackage(up)) roots.push(up);
    rootsOf.set(dir, roots);
    return roots;
  };

  const relative = (from: string, specifier: string): string | null => {
    const dots = specifier.length - specifier.replace(/^\.+/, '').length;
    const segments = parentOf(from).split('/').filter(Boolean);
    if (dots - 1 > segments.length) return null;
    const base = segments.slice(0, segments.length - (dots - 1));
    const path = join(...base, ...specifier.slice(dots).split('.').filter(Boolean));
    return regular(path) ?? namespace(path);
  };

  const absolute = (from: string, specifier: string): string | null => {
    const parts = specifier.split('.');
    const roots = rootsFor(parentOf(from));
    const only = topLevel.get(parts[0] ?? '');
    const known = only?.size === 1 ? [...only] : [];
    const places = [...roots, ...known.filter((root) => !roots.includes(root))];
    const at = (find: (path: string) => string | null): string | null =>
      places.map((root) => find(join(root, ...parts))).find(Boolean) ?? null;
    return at(regular) ?? at(namespace);
  };

  return {
    resolve: (from, specifier) =>
      specifier.startsWith('.') ? relative(from, specifier) : absolute(from, specifier),
    foreign: (_from, specifier) => !specifier.startsWith('.'),
    child(module, segment) {
      const isPackage = PACKAGE_FILES.some((name) => module.endsWith(name));
      if (!isPackage) return null;
      const path = join(parentOf(module), segment);
      return regular(path) ?? namespace(path);
    },
  };
}
