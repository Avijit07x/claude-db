import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export interface UsageMatch {
  file: string;
  line: number;
  text: string;
  isDefinition: boolean;
  isMatch: boolean;
}

export interface UsagesResult {
  root: string;
  matches: UsageMatch[];
  total: number;
  truncated: boolean;
}

export interface FindUsagesInput {
  symbol: string;
  path?: string;
  regex: boolean;
  context: number;
  limit: number;
}

const MAX_BUFFER = 16 * 1024 * 1024;

export function findUsages(input: FindUsagesInput): UsagesResult {
  const start = realpathSync(resolve(input.path ?? process.cwd()));
  const root = repoRootFor(start);
  const args = buildArgs(input);

  if (input.path) {
    const scope = relative(root, start);
    if (scope && !scope.startsWith('..')) args.push('--', scope);
  }

  let raw: string;
  try {
    raw = execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: MAX_BUFFER });
  } catch (error) {
    const err = error as { status?: number; stderr?: string; message: string };
    if (err.status === 1) return { root, matches: [], total: 0, truncated: false };
    if (/maxBuffer/i.test(err.message)) {
      throw new Error(
        `too many matches for "${input.symbol}" to read at once — narrow it ` +
          '(a longer name, --path to a subdirectory, or --regex to anchor it tighter)',
      );
    }
    throw new Error((err.stderr ?? err.message).trim().split('\n')[0]);
  }

  const parsed = parseGrepOutput(raw).map((row) => ({
    ...row,
    isDefinition: isDefinitionLike(input.symbol, row.text),
    isMatch: true,
  }));
  const kept = parsed.slice(0, input.limit);

  return {
    root,
    matches: input.context > 0 ? withContext(root, kept, input.context) : kept,
    total: parsed.length,
    truncated: parsed.length > input.limit,
  };
}

export function repoRootFor(start: string): string {
  const dir = statSync(start).isDirectory() ? start : dirname(start);
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
    }).trim();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`${start} is not inside a git working tree${stderr ? ` (${stderr})` : ''}`);
  }
}

function buildArgs({ symbol, regex }: FindUsagesInput): string[] {
  const args = ['grep', '-n', '-z', '-I', '--untracked'];
  args.push(...(regex ? ['--extended-regexp'] : ['--fixed-strings', '--word-regexp']));
  args.push('-e', symbol);
  return args;
}

function withContext(root: string, matches: UsageMatch[], context: number): UsageMatch[] {
  const fileLines = new Map<string, string[] | null>();
  const out: UsageMatch[] = [];
  let lastFile = '';
  let lastLineShown = 0;

  for (const m of matches) {
    let lines = fileLines.get(m.file);
    if (lines === undefined) {
      try {
        lines = readFileSync(join(root, m.file), 'utf8').split('\n');
      } catch {
        lines = null;
      }
      fileLines.set(m.file, lines);
    }
    if (!lines) {
      out.push(m);
      continue;
    }

    const from = Math.max(1, m.line - context);
    const to = Math.min(lines.length, m.line + context);
    const start = m.file === lastFile ? Math.max(from, lastLineShown + 1) : from;
    for (let n = start; n <= to; n += 1) {
      out.push(
        n === m.line
          ? m
          : {
              file: m.file,
              line: n,
              text: lines[n - 1] ?? '',
              isDefinition: false,
              isMatch: false,
            },
      );
    }
    lastFile = m.file;
    lastLineShown = to;
  }
  return out;
}

function parseGrepOutput(raw: string): { file: string; line: number; text: string }[] {
  const rows: { file: string; line: number; text: string }[] = [];
  for (const record of raw.split('\n')) {
    if (!record.includes('\0')) continue;
    const [file, lineStr, ...rest] = record.split('\0');
    const line = Number(lineStr);
    if (!file || !Number.isFinite(line)) continue;
    rows.push({ file, line, text: rest.join('\0') });
  }
  return rows;
}

function isDefinitionLike(symbol: string, text: string): boolean {
  const s = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `\\b(function\\*?\\s+${s}\\b` +
      `|class\\s+${s}\\b` +
      `|(?:interface|type|enum)\\s+${s}\\b` +
      `|(?:export\\s+)?(?:const|let|var)\\s+${s}\\s*[:=]` +
      `|export\\s*\\{[^}]*\\b${s}\\b)`,
  ).test(text);
}

export function formatUsages(result: UsagesResult, suggestions: string[] = []): string {
  if (result.matches.length === 0) {
    return (
      `No usages of that symbol found under ${result.root}.` +
      (suggestions.length > 0 ? `\nDid you mean: ${suggestions.join(', ')}` : '')
    );
  }
  const rows = result.matches.map(
    (m) =>
      `${m.file}${m.isMatch ? ':' : '-'}${m.line}${m.isDefinition ? '  [definition?]' : ''}  ${m.text.trim()}`,
  );
  const shown = result.matches.filter((m) => m.isMatch).length;
  const header = result.truncated
    ? `showing ${shown} of ${result.total}+ match(es) (raise \`limit\` or narrow \`symbol\`):`
    : `${result.total} match(es):`;
  return `${header}\n${rows.join('\n')}`;
}
