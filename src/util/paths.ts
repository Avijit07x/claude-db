export function toPosix(path: string): string {
  return path.replace(/\\/g, '/');
}

export function mentionsPath(text: string, needle: string): boolean {
  const flatten = (value: string): string => toPosix(value).replace(/\/+/g, '/');
  return flatten(text).includes(flatten(needle));
}
