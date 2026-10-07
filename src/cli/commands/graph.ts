import { createContext } from '../../context.js';
import type { MemoryStore } from '../../store/adapter.js';
import { findUsages, formatUsages, repoRootFor } from '../../usages/index.js';
import {
  NO_GRAPH,
  NO_GRAPH_FOR_PATH,
  answerQuery,
  formatGraph,
  hasGraph,
  languageNames,
  refreshGraph,
  saveScan,
  scanRepository,
  suggestFor,
} from '../../graph/index.js';
import type { ScanResult } from '../../graph/scan/index.js';
import { PLATFORM } from '../../graph/grammars.js';
import { GRAPH_JOB } from '../../graph/scan/job.js';
import { releaseJob } from '../../util/job-lock.js';
import { resolveProject } from '../../util/project.js';
import { valueOf, withoutFlags } from '../args.js';

function printScan(root: string, scan: ScanResult, elapsedMs: number): void {
  console.log(`Scanned ${root}`);
  console.log(
    `  ${scan.symbols.length} symbols, ${scan.edges.length} edges written for ` +
      `${scan.rewrite.length} file(s)`,
  );
  console.log(
    `  ${scan.changed.length} file(s) parsed, ${scan.skipped} unchanged, ` +
      `${scan.unsupported} not a supported language`,
  );
  console.log(`  ${elapsedMs}ms  (languages: ${languageNames()})`);
  for (const [language, count] of Object.entries(scan.patternRead)) {
    console.log(
      `  ${count} ${language} file(s) are read by pattern: this install has no ${language} ` +
        `grammar for ${PLATFORM}. Reinstall claude-db to add it.`,
    );
  }
  if (scan.symbols.length === 0 && scan.changed.length > 0) {
    console.log('  Nothing was extracted, which usually means no supported source files.');
  }
}

async function runScan(root: string, project: string, force: boolean): Promise<void> {
  const ctx = await createContext();
  try {
    const stored = new Map(
      (await ctx.store.scannedFiles(project)).map((file) => [file.path, file.hash]),
    );
    const started = Date.now();
    const scan = await scanRepository({ root, project, stored, force });
    await saveScan(ctx.store, project, scan, force);
    printScan(root, scan, Date.now() - started);
  } finally {
    await ctx.close();
  }
}

async function runRefresh(root: string, project: string): Promise<void> {
  const ctx = await createContext();
  try {
    await refreshGraph(ctx.store, root, project);
  } finally {
    await ctx.close();
  }
}

export async function cmdScan(argv: (string | undefined)[]): Promise<void> {
  const path = valueOf(argv, '--path');
  const root = repoRootFor(path ?? process.cwd());
  const project = resolveProject(undefined);
  if (!argv.includes('--background')) {
    await runScan(root, project, argv.includes('--force'));
    return;
  }
  try {
    await runRefresh(root, project);
  } finally {
    releaseJob(GRAPH_JOB, project);
  }
}

const MODES = ['text', 'usages', 'explain', 'path'] as const;
type UsagesMode = (typeof MODES)[number];

interface UsagesInput {
  words: string;
  mode: UsagesMode;
  regex: boolean;
  context: number;
  limit: number;
  path?: string;
  target?: string;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const isMode = (value: string): value is UsagesMode => (MODES as readonly string[]).includes(value);

function usagesInput(argv: (string | undefined)[]): UsagesInput {
  const path = valueOf(argv, '--path');
  const target = valueOf(argv, '--target');
  const mode = valueOf(argv, '--mode') ?? 'usages';
  const context = Number(valueOf(argv, '--context') ?? 0);
  const limit = Number(valueOf(argv, '--limit') ?? 100);
  const words = withoutFlags(argv, ['--path', '--context', '--limit', '--mode', '--target'])
    .filter((arg) => arg !== '--regex')
    .join(' ')
    .trim();

  if (!words) {
    fail(
      'Usage: claude-db usages [--mode usages|explain|path|text] [--regex] ' +
        '[--context <n>] [--path <dir>] [--limit <n>] <symbol> [<target>]',
    );
  }
  if (!Number.isFinite(context) || context < 0) fail('--context must be a non-negative number.');
  if (!Number.isFinite(limit) || limit <= 0) fail('--limit must be a positive number.');
  if (!isMode(mode)) fail(`Unknown --mode "${mode}". Use usages, explain, path or text.`);
  return {
    words,
    mode,
    regex: argv.includes('--regex'),
    context,
    limit,
    ...(path ? { path } : {}),
    ...(target ? { target } : {}),
  };
}

async function textAnswer(store: MemoryStore, input: UsagesInput): Promise<string> {
  const { words, regex, context, limit, path } = input;
  const result = findUsages({ symbol: words, regex, context, limit, ...(path ? { path } : {}) });
  const missed =
    result.matches.length === 0 ? await suggestFor(store, resolveProject(undefined), words) : [];
  return formatUsages(result, missed);
}

async function graphAnswer(store: MemoryStore, input: UsagesInput): Promise<string> {
  const [symbol = '', positional] = input.words.split(/\s+/);
  const target = input.target ?? positional;
  if (input.mode === 'path' && !target) {
    fail('--mode path needs two symbols: claude-db usages --mode path <from> <to>');
  }
  const project = resolveProject(undefined);
  if (!(await hasGraph(store, project))) {
    if (input.mode === 'path') fail(NO_GRAPH_FOR_PATH);
    return `${NO_GRAPH}\n${await textAnswer(store, input)}`;
  }
  const root = repoRootFor(input.path ?? process.cwd());
  const mode = input.mode === 'text' ? 'usages' : input.mode;
  const answer = await answerQuery({
    store,
    root,
    project,
    query: { mode, symbol, ...(target ? { target } : {}), limit: input.limit },
    refresh: true,
  });
  return formatGraph(answer, root);
}

export async function cmdUsages(argv: (string | undefined)[]): Promise<void> {
  const input = usagesInput(argv);
  const ctx = await createContext();
  try {
    const text =
      input.mode === 'text'
        ? await textAnswer(ctx.store, input)
        : await graphAnswer(ctx.store, input);
    console.log(text);
  } finally {
    await ctx.close();
  }
}
