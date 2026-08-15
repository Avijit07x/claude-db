#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext } from '../context.js';
import { emitContext, readPayload, runHook } from './payload.js';
import { resolveProject } from '../util/project.js';
import { updateNotice } from '../update.js';
import { silenceSqliteWarning } from '../util/warnings.js';

silenceSqliteWarning();

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'server.js');

function mcpRegistered(project: string): boolean {
  return [join(project, '.mcp.json'), join(homedir(), '.claude.json')].some((path) => {
    try {
      return readFileSync(path, 'utf8').includes(SERVER);
    } catch {
      return false;
    }
  });
}

/**
 * SessionStart: prime the agent with what past sessions concluded.
 *
 * Only session summaries are injected, never raw observations. Summaries are
 * dense and few; observations are numerous and are better pulled on demand
 * through the MCP tools once the agent knows what it is looking for.
 */
await runHook(async () => {
  const payload = await readPayload();
  const project = resolveProject(payload.cwd);

  const ctx = await createContext();
  try {
    const sessions = await ctx.store.recentSessions(project, ctx.config.inject.sessions);

    // One line on an empty database, so "installed but no history yet" is
    // distinguishable from "never installed" without leaving the session.
    // Costs ~12 tokens and disappears permanently after the first real session.
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

    lines.push('</project-memory>');
    // Only advertise the tools when they are actually registered; pointing the
    // agent at an MCP server that was never installed just wastes a turn.
    if (mcpRegistered(project)) {
      lines.push(
        'Search this project\'s full history with the memory MCP tools before ' +
          'asking the user to re-explain prior decisions.',
      );
    }

    // Read from a local file the detached updater wrote; never a live check.
    const notice = ctx.config.updates === 'off' ? null : updateNotice();
    if (notice) lines.push(notice);

    emitContext(`${lines.join('\n')}\n`);
  } finally {
    await ctx.close();
  }
});
