const SHORT_LENGTH = 13;

export function toShortId(id: string): string {
  return id.slice(0, SHORT_LENGTH);
}

export function isShortId(id: string): boolean {
  return id.length < 36;
}

export function partitionIds(ids: string[]): { exact: string[]; prefixes: string[] } {
  const exact: string[] = [];
  const prefixes: string[] = [];
  for (const id of ids) {
    if (isShortId(id)) prefixes.push(id);
    else exact.push(id);
  }
  return { exact, prefixes };
}
