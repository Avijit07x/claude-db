/**
 * Maps a project path to a single opaque FTS-safe token.
 *
 * Project paths contain slashes, dots and hyphens, all of which FTS5 treats as
 * token separators, so a path cannot be matched as one unit. Hashing it to a
 * single alphanumeric token lets project scoping happen inside the FTS match
 * instead of as a post-match join, which is the difference between scanning
 * one project's index and scanning every project's.
 */
export function scopeToken(project: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < project.length; i += 1) {
    hash ^= project.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `scope${(hash >>> 0).toString(36)}`;
}
