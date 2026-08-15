import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Canonicalises a project path so scoping survives symlinks.
 *
 * Project scoping is an exact string comparison, so two spellings of the same
 * directory silently split a project's memory in half. macOS makes this the
 * default case rather than an edge case: `/tmp` is a symlink to `/private/tmp`
 * and `/var` to `/private/var`, so a hook receiving `cwd` from the agent and a
 * CLI reading `process.cwd()` disagree about the same folder.
 *
 * Resolving to the real path makes every entry point agree. Falls back to the
 * absolute path when the directory does not exist yet, which keeps callers
 * working against paths that have not been created.
 */
export function resolveProject(path: string | undefined): string {
  const absolute = resolve(path ?? process.cwd());
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}
