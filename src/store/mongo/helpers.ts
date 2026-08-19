export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function databaseNameFrom(uri: string): string | null {
  const match = /\/\/[^/]+\/([^?]+)/.exec(uri);
  const name = match?.[1]?.trim();
  return name && name.length > 0 ? name : null;
}
