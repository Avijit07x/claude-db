import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';

export interface UsageMatch {
  file: string; // relative to the repo root
  line: number;
  text: string;
  isDefinition: boolean;
}

export interface UsagesResult {
  root: string;
  matches: UsageMatch[];
  total: number; // full parsed count, before `limit` truncation
  truncated: boolean;
}

export interface FindUsagesInput {
  symbol: string;
  path?: string;
  regex: boolean;
  context: number;
  limit: number;
}

// A hit here means the term is too generic to be a symbol lookup at all; the
// fix is a narrower query, not a bigger buffer.
const MAX_BUFFER = 16 * 1024 * 1024;

/**
 * Live `git grep`, never a persisted index.
 *
 * A symbol index that drifts from an edit is the same failure shape as every
 * silent-staleness bug this project has already shipped and fixed. This
 * re-derives the answer from the current source on every call, so there is
 * nothing to invalidate.
 */
export function findUsages(input: FindUsagesInput): UsagesResult {
  // realpath'd up front: git's own --show-toplevel always resolves symlinks
  // (on macOS, tmpdir()'s /var/folders/... is itself a symlink to
  // /private/var/folders/...), so comparing an un-resolved `start` against it
  // below would produce a bogus, always-".."-prefixed relative path and
  // silently disable scoping rather than apply it.
  const start = realpathSync(resolve(input.path ?? process.cwd()));
  const root = repoRootFor(start);
  const args = buildArgs(input);

  // An explicit path narrows the search to that subtree; omitting it searches
  // the whole repository. Defaulting to cwd's subtree would silently hide a
  // usage that lives elsewhere in the repo — exactly the case this tool
  // exists to catch — so only a caller who deliberately asked to narrow gets
  // narrowed. git accepts a file or a directory here equally.
  if (input.path) {
    const scope = relative(root, start);
    if (scope && !scope.startsWith('..')) args.push('--', scope);
  }

  let raw: string;
  try {
    raw = execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: MAX_BUFFER });
  } catch (error) {
    const err = error as { status?: number; stderr?: string; message: string };
    // git grep exits 1 for "ran fine, found nothing" — not an error.
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
  }));

  return {
    root,
    matches: parsed.slice(0, input.limit),
    total: parsed.length,
    truncated: parsed.length > input.limit,
  };
}

/**
 * Deliberately not resolveProject(): that widens to the repository root for
 * MEMORY partitioning, and inside a workspace pooling several sibling repos
 * it can resolve to a directory that is not itself a git working tree, which
 * `git grep` cannot search at all. Delegating to git's own discovery keeps
 * this in sync with whatever repo git itself would act on (worktrees,
 * submodules, symlinks included) without a second implementation of the walk.
 */
function repoRootFor(start: string): string {
  try {
    return execFileSync('git', ['-C', start, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
    }).trim();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`${start} is not inside a git working tree${stderr ? ` (${stderr})` : ''}`);
  }
}

function buildArgs({ symbol, regex, context }: FindUsagesInput): string[] {
  // -I: skip binary files — a binary hit otherwise prints a headerless
  // "Binary file X matches" line that corrupts the -z parse below.
  // --untracked: a brand-new file the agent just created and has not `git
  // add`ed yet is exactly the blast-radius case this tool exists for; without
  // this flag it is silently invisible. Still respects .gitignore.
  const args = ['grep', '-n', '-z', '-I', '--untracked'];
  if (context > 0) args.push(`-B${context}`, `-A${context}`);
  // Word-regexp only in literal mode: a regex author already controls their
  // own boundaries, so imposing one on top would be a surprise, not a safety net.
  args.push(...(regex ? ['--extended-regexp'] : ['--fixed-strings', '--word-regexp']));
  args.push('-e', symbol);
  return args;
}

/** `-z` NUL-delimits path\0line\0content per record; a stray line with no
 *  NUL (a `--` context divider, a binary-match notice) is simply dropped. */
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

/**
 * Cheap, best-effort "this looks like the declaration" marker. Unlike
 * classifyTurn's `because` regression, this never hides or filters a line —
 * it only annotates one already-shown line, so a false positive costs a
 * wrong label, not a silently misfiled result.
 */
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

export function formatUsages(result: UsagesResult): string {
  if (result.matches.length === 0) return `No usages of that symbol found under ${result.root}.`;
  const rows = result.matches.map(
    (m) => `${m.file}:${m.line}${m.isDefinition ? '  [definition?]' : ''}  ${m.text.trim()}`,
  );
  const header = result.truncated
    ? `showing ${result.matches.length} of ${result.total}+ match(es) (raise \`limit\` or narrow \`symbol\`):`
    : `${result.total} match(es):`;
  return `${header}\n${rows.join('\n')}`;
}
