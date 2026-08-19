import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

export function resolveProject(path: string | undefined): string {
  const absolute = resolve(path ?? process.cwd());
  let canonical: string;
  try {
    canonical = realpathSync(absolute);
  } catch {
    return absolute;
  }
  return repoRoot(canonical) ?? canonical;
}

function repoRoot(start: string): string | null {
  const home = canonicalHome();

  for (let dir = start; ;) {
    if (dir === sep || dir === home || home.startsWith(dir + sep)) return null;
    if (existsSync(join(dir, '.git'))) return dir;

    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

let cachedHome: string | null = null;

function canonicalHome(): string {
  if (cachedHome === null) {
    try {
      cachedHome = realpathSync(homedir());
    } catch {
      cachedHome = homedir();
    }
  }
  return cachedHome;
}
