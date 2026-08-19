import type { Scope } from './paths.js';

export function valueOf(argv: (string | undefined)[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function withoutFlags(argv: (string | undefined)[], flags: string[]): string[] {
  const dropped = new Set<number>();
  for (const flag of flags) {
    const at = argv.indexOf(flag);
    if (at >= 0) dropped.add(at).add(at + 1);
  }
  return argv.filter((arg, index): arg is string => typeof arg === 'string' && !dropped.has(index));
}

export function scopeFrom(args: (string | undefined)[]): Scope {
  return args.includes('--project') || args.includes('-p') ? 'project' : 'global';
}
