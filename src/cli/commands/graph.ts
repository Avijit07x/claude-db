import { createContext } from '../../context.js';
import { findUsages, formatUsages, repoRootFor } from '../../usages/index.js';
import {
  formatGraph,
  languageNames,
  queryGraph,
  refreshGraph,
  scanRepository,
} from '../../graph/index.js';
import { join } from 'node:path';
import { resolveProject } from '../../util/project.js';
import { valueOf, withoutFlags } from '../args.js';

export async function cmdScan(argv: (string | undefined)[]): Promise<void> {
  const force = argv.includes('--force');
  const path = valueOf(argv, '--path');
  const root = repoRootFor(path ?? process.cwd());
  const project = resolveProject(undefined);

  const ctx = await createContext();
  try {
    const known = force
      ? new Map<string, string>()
      : new Map((await ctx.store.scannedFiles(project)).map((f) => [f.path, f.hash]));

    const started = Date.now();
    const scan = scanRepository({ root, project, known, ...(force ? { force } : {}) });

    if (force) await ctx.store.removeGraph(project);
    else if (scan.changed.length > 0) await ctx.store.removeGraph(project, scan.changed);

    await ctx.store.upsertGraph({
      symbols: scan.symbols,
      edges: scan.edges,
      files: scan.files,
    });

    console.log(`Scanned ${root}`);
    console.log(`  ${scan.symbols.length} symbols, ${scan.edges.length} edges`);
    console.log(
      `  ${scan.changed.length} file(s) parsed, ${scan.skipped} unchanged, ` +
        `${scan.unsupported} not a supported language`,
    );
    console.log(`  ${Date.now() - started}ms  (languages: ${languageNames()})`);
    if (scan.symbols.length === 0 && scan.changed.length > 0) {
      console.log('  Nothing was extracted, which usually means no supported source files.');
    }
  } finally {
    await ctx.close();
  }
}

export async function cmdUsages(argv: (string | undefined)[]): Promise<void> {
  const regex = argv.includes('--regex');
  const path = valueOf(argv, '--path');
  const context = Number(valueOf(argv, '--context') ?? 0);
  const limit = Number(valueOf(argv, '--limit') ?? 100);
  const mode = valueOf(argv, '--mode') ?? 'text';
  const words = withoutFlags(argv, ['--path', '--context', '--limit', '--mode'])
    .filter((arg) => arg !== '--regex')
    .join(' ')
    .trim();

  if (!words) {
    console.error(
      'Usage: claude-db usages [--mode text|usages|explain|path] [--regex] ' +
        '[--context <n>] [--path <dir>] [--limit <n>] <symbol> [<target>]',
    );
    process.exit(1);
  }
  if (!Number.isFinite(context) || context < 0) {
    console.error('--context must be a non-negative number.');
    process.exit(1);
  }
  if (!Number.isFinite(limit) || limit <= 0) {
    console.error('--limit must be a positive number.');
    process.exit(1);
  }

  if (mode === 'text') {
    console.log(
      formatUsages(findUsages({ symbol: words, regex, context, limit, ...(path ? { path } : {}) })),
    );
    return;
  }
  if (mode !== 'usages' && mode !== 'explain' && mode !== 'path') {
    console.error(`Unknown --mode "${mode}". Use text, usages, explain or path.`);
    process.exit(1);
  }

  const [symbol, target] = words.split(/\s+/);
  if (mode === 'path' && !target) {
    console.error('--mode path needs two symbols: claude-db usages --mode path <from> <to>');
    process.exit(1);
  }

  const root = repoRootFor(path ?? process.cwd());
  const project = resolveProject(undefined);
  const ctx = await createContext();
  try {
    const refreshed = await refreshGraph(ctx.store, root, project);
    const answer = await queryGraph(ctx.store, project, {
      mode,
      symbol: symbol ?? '',
      ...(target ? { target } : {}),
      limit,
    });
    answer.refreshed = refreshed;
    console.log(formatGraph(answer, root));
  } finally {
    await ctx.close();
  }
}
