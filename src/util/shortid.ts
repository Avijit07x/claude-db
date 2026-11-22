const SHORT_LENGTH = 13;

export function toShortId(id: string): string {
  return id.slice(0, SHORT_LENGTH);
}

const VALID_ID = /^[0-9a-f-]{8,36}$/;

export function assertValidIds(ids: string[]): void {
  const bad = ids.find((id) => !VALID_ID.test(id));
  if (bad === undefined) return;
  throw new Error(
    `${JSON.stringify(bad)} is not an observation id. Use the 8 to 36 hex characters search prints.`,
  );
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
