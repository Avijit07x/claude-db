import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { distillNotice } from '../../facts/notice.js';
import { recentWorkBlock, startFacts } from '../../facts/start.js';
import { startBackgroundWork } from '../background.js';
import { noteGraphPresence } from '../graph-presence.js';
import { refreshGraphInBackground } from '../graph-refresh.js';
import { recoverAfterCompact } from '../compact.js';
import { capturingDisabled, emitSessionStart } from '../payload.js';
import type { HookRun } from '../run.js';
import { markShown } from '../shown.js';
import { legacyBlock } from '../start-legacy.js';
import { resolveProject } from '../../util/project.js';
import { mentionsPath } from '../../util/paths.js';
import { repoRootFor } from '../../usages/index.js';
import { refreshInstalled } from '../../cli/refresh.js';
import { updateNotice } from '../../update.js';

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'mcp', 'server.js');

const SCAN_HINT =
  'Code graph not built yet — run `claude-db scan` once to enable ' +
  'find_usages and the symbol-grep hook.';

function refreshGraphQuietly(project: string): void {
  try {
    refreshGraphInBackground(project, repoRootFor(project));
  } catch {
    return;
  }
}

function refreshInstalledQuietly(project: string): void {
  try {
    refreshInstalled(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), project);
  } catch {
    return;
  }
}

function isGitRepo(project: string): boolean {
  try {
    repoRootFor(project);
    return true;
  } catch {
    return false;
  }
}

function mcpRegistered(project: string): boolean {
  return [join(project, '.mcp.json'), join(homedir(), '.claude.json')].some((path) => {
    try {
      return mentionsPath(readFileSync(path, 'utf8'), SERVER);
    } catch {
      return false;
    }
  });
}

export default async function sessionStart(run: HookRun): Promise<void> {
  const { payload } = run;
  const project = resolveProject(payload.cwd);

  refreshInstalledQuietly(project);

  await run.withContext(async (ctx) => {
    const capturing = !capturingDisabled(ctx.config.capture.scripted, run.env);
    if (capturing) startBackgroundWork(project, ctx.config.database);

    const earlier =
      payload.source === 'compact' && payload.session_id
        ? await recoverAfterCompact(ctx, project, payload.session_id, payload.transcript_path)
        : null;
    const restored = earlier?.ids ?? new Set<string>();

    const facts = await startFacts(ctx, project, restored, payload.session_id);
    const recent = facts ? null : await recentWorkBlock(ctx, project, payload.session_id, restored);
    const legacy = facts ? null : await legacyBlock(ctx, project, restored);
    const shown = [...(facts?.ids ?? []), ...(recent?.ids ?? [])];
    if (shown.length > 0 && payload.session_id) markShown(payload.session_id, shown);

    const fallback = legacy?.hasMemory || !recent ? legacy?.text : undefined;
    const parts = [earlier?.block, facts?.block ?? fallback, recent?.block].filter(
      (part): part is string => Boolean(part),
    );
    if ((facts || recent || legacy?.hasMemory) && mcpRegistered(project)) {
      parts.push(
        "Search this project's full history with the memory MCP tools before " +
          'asking the user to re-explain prior decisions.',
      );
    }
    const scanned = (await ctx.store.scannedFiles(project, 1)).length > 0;
    noteGraphPresence(project, scanned);
    if (!scanned && isGitRepo(project)) parts.push(SCAN_HINT);
    const update = ctx.config.updates === 'off' ? null : updateNotice();
    if (update) parts.push(update);

    const body = parts.join('\n');
    const notice = capturing ? await distillNotice(ctx, project) : null;
    emitSessionStart(
      `${body}\n(context ≈ ${Math.round(body.length / 4)} tokens)\n`,
      notice,
      run.write,
    );
    if (scanned) refreshGraphQuietly(project);
  });
}
