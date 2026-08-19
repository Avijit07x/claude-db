#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext } from '../context.js';
import { openWork } from '../capture/index.js';
import type { MemoryStore } from '../store/index.js';
import { emitContext, readPayload, runHook } from './payload.js';
import { resolveProject } from '../util/project.js';
import { refreshInstalled } from '../cli/refresh.js';
import { updateNotice } from '../update.js';
import { silenceSqliteWarning } from '../util/warnings.js';

silenceSqliteWarning();

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'server.js');

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
      return readFileSync(path, 'utf8').includes(SERVER);
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
    const sessions = await ctx.store.recentSessions(project, ctx.config.inject.sessions);

    if (sessions.length === 0) {
      emitContext(
        '<project-memory>none yet for this project; ' +
          'it is recorded as you work</project-memory>\n',
      );
      return;
    }

    const lines = ['<project-memory>'];
    let budget = ctx.config.inject.maxChars;

    for (const session of sessions) {
      const when = new Date(session.startedAt).toISOString().slice(0, 10);
      const line = `- [${when}] ${session.summary ?? ''}`;
      if (line.length > budget) break;
      budget -= line.length;
      lines.push(line);
    }

    const open = await openWork(ctx.store, project);
    if (open.length > 0) {
      lines.push('');
      lines.push('Not committed yet, newest first:');
      for (const obs of open.slice(0, 3)) {
        lines.push(`- ${obs.title}`);
      }
    }

    lines.push('</project-memory>');
    if (mcpRegistered(project)) {
      lines.push(
        "Search this project's full history with the memory MCP tools before " +
          'asking the user to re-explain prior decisions.',
      );
    }

    const notice = ctx.config.updates === 'off' ? null : updateNotice();
    if (notice) lines.push(notice);

    emitContext(`${lines.join('\n')}\n`);
    await refreshGraphQuietly(ctx.store, project);
  } finally {
    await ctx.close();
  }
});
