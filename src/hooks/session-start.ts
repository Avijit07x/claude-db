#!/usr/bin/env node
import { createContext } from '../context.js';
import { emitContext, readPayload, runHook } from './payload.js';
import { resolveProject } from '../util/project.js';
import { silenceSqliteWarning } from '../util/warnings.js';

silenceSqliteWarning();

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
          'it is recorded when a session ends</project-memory>\n',
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
    lines.push(
      'Search this project\'s full history with the memory MCP tools before ' +
        'asking the user to re-explain prior decisions.',
    );

    emitContext(`${lines.join('\n')}\n`);
  } finally {
    await ctx.close();
  }
});
