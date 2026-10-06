#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext } from '../context.js';
import { distillNotice } from '../facts/notice.js';
import { startFacts } from '../facts/start.js';
import type { MemoryStore } from '../store/index.js';
import { startBackgroundWork } from './background.js';
import { recoverAfterCompact } from './compact.js';
import { capturingDisabled, emitSessionStart, readPayload, runHook } from './payload.js';
import { markShown } from './shown.js';
import { legacyBlock } from './start-legacy.js';
import { resolveProject } from '../util/project.js';
import { mentionsPath } from '../util/paths.js';
import { refreshInstalled } from '../cli/refresh.js';
import { updateNotice } from '../update.js';
import { silenceSqliteWarning } from '../util/warnings.js';

silenceSqliteWarning();

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'server.js');

const SCAN_HINT =
  'Code graph not built yet — run `claude-db scan` once to enable ' +
  'find_usages and the symbol-grep hook.';

async function refreshGraphQuietly(store: MemoryStore, project: string): Promise<void> {
  try {
    if ((await store.scannedFiles(project)).length === 0) return;
    const { refreshGraph } = await import('../graph/index.js');
    const { repoRootFor } = await import('../usages/index.js');
    await refreshGraph(store, repoRootFor(project), project);
  } catch {
    return;
  }
}

function refreshInstalledQuietly(project: string): void {
  try {
    refreshInstalled(resolve(dirname(fileURLToPath(import.meta.url)), '..'), project);
  } catch {
    return;
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

await runHook(async () => {
  const payload = await readPayload();
  const project = resolveProject(payload.cwd);

  refreshInstalledQuietly(project);

  const ctx = await createContext();
  try {
    const capturing = !capturingDisabled(ctx.config.capture.scripted);
    if (capturing) startBackgroundWork(project, ctx.config.database);

    const earlier =
      payload.source === 'compact' && payload.session_id
        ? await recoverAfterCompact(ctx, project, payload.session_id, payload.transcript_path)
        : null;
    const restored = earlier?.ids ?? new Set<string>();

    const facts = await startFacts(ctx, project, restored);
    const legacy = facts ? null : await legacyBlock(ctx, project, restored);
    if (facts && payload.session_id) markShown(payload.session_id, [...facts.ids]);

    const parts = [earlier?.block, facts?.block ?? legacy?.text].filter((part): part is string =>
      Boolean(part),
    );
    if ((facts || legacy?.hasMemory) && mcpRegistered(project)) {
      parts.push(
        "Search this project's full history with the memory MCP tools before " +
          'asking the user to re-explain prior decisions.',
      );
    }
    if ((await ctx.store.scannedFiles(project)).length === 0) parts.push(SCAN_HINT);
    const update = ctx.config.updates === 'off' ? null : updateNotice();
    if (update) parts.push(update);

    const body = parts.join('\n');
    const notice = capturing ? await distillNotice(ctx, project) : null;
    emitSessionStart(`${body}\n(context ≈ ${Math.round(body.length / 4)} tokens)\n`, notice);
    await refreshGraphQuietly(ctx.store, project);
  } finally {
    await ctx.close();
  }
});
