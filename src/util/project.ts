import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

/**
 * Canonicalises a project path so scoping survives symlinks, then widens it to
 * the repository root so every directory inside a repo keys the same memory.
 *
 * Scoping is an exact string comparison, so two spellings of the same place
 * silently split a project's memory in half. macOS makes symlinks the default
 * case rather than an edge case: `/tmp` links to `/private/tmp`, so a hook
 * reading `cwd` and a CLI reading `process.cwd()` disagree about one folder.
 * Subdirectories are the same failure by a different route: running the agent
 * from `repo/frontend` used to start a second, empty memory, indistinguishable
 * from never having worked in the repo at all.
 */
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

/**
 * Nearest ancestor containing a `.git` entry, or null outside a work tree.
 *
 * Never returns the home directory or anything above it. People keep dotfiles
 * repositories in `$HOME`, and without that guard every unrelated project on
 * the machine would walk up, find `~/.git`, and collapse into a single shared
 * memory. A directory that merely holds several repositories is not a repo
 * itself, so it keeps its own key and its contents stay pooled.
 *
 * `.git` is a file rather than a directory in worktrees and submodules, so
 * this tests for existence, not for a directory.
 */
function repoRoot(start: string): string | null {
  const home = canonicalHome();

  for (let dir = start; ; ) {
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
