export function scopeToken(project: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < project.length; i += 1) {
    hash ^= project.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `scope${(hash >>> 0).toString(36)}`;
}
