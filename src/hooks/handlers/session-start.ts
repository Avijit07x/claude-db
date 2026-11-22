import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sweepCursorsDaily } from '../../capture/index.js';
import { loadConfig } from '../../config/index.js';
import { distillNotice } from '../../facts/notice.js';
import { startFacts } from '../../facts/start.js';
import { startBackgroundWork } from '../background.js';
import { noteGraphPresence } from '../graph-presence.js';
import { refreshGraphInBackground } from '../graph-refresh.js';
import { recoverAfterCompact } from '../compact.js';
import { capturingDisabled, emitSessionStart } from '../payload.js';
import type { HookRun } from '../run.js';
import { markShown } from '../shown.js';
import { resolveProject } from '../../util/project.js';
import { repoRootFor } from '../../usages/index.js';
import { refreshInstalled } from '../../cli/refresh.js';
import { updateNotice } from '../../update.js';

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

function sweepCursorsQuietly(): void {
  try {
    sweepCursorsDaily();
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

export default async function sessionStart(run: HookRun): Promise<void> {
  const { payload } = run;
  const project = resolveProject(payload.cwd);

  refreshInstalledQuietly(project);
  if (capturingDisabled(loadConfig().capture.scripted, run.env)) return;

  await run.withContext(async (ctx) => {
    startBackgroundWork(project, ctx.config.database);

    const earlier =
      payload.source === 'compact' && payload.session_id
        ? await recoverAfterCompact(
            ctx,
            project,
            payload.session_id,
            payload.transcript_path,
            run.env,
          )
        : null;
    const restored = earlier?.ids ?? new Set<string>();

    const facts = await startFacts(ctx, project, restored, payload.session_id, earlier?.titles);
    if (facts && payload.session_id) markShown(payload.session_id, [...facts.ids]);

    const scanned = (await ctx.store.scannedFiles(project, 1)).length > 0;
    noteGraphPresence(project, scanned);
    const update = ctx.config.updates === 'off' ? null : updateNotice();
    const notice = [
      await distillNotice(ctx, project),
      !scanned && isGitRepo(project) ? SCAN_HINT : null,
      update,
    ]
      .filter(Boolean)
      .join('\n');

    const body = [earlier?.block, facts?.block].filter(Boolean).join('\n');
    emitSessionStart(body ? `${body}\n` : '', notice || null, run.write);
    if (scanned) refreshGraphQuietly(project);
    sweepCursorsQuietly();
  });
}
