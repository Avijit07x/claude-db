#!/usr/bin/env node
import { flushSession } from '../capture/index.js';
import { createContext } from '../context.js';
import { emitContext, readPayload, runHook } from './payload.js';
import { isSearchable, renderPromptContext } from './relevance.js';
import { resolveProject } from '../util/project.js';
import { silenceSqliteWarning } from '../util/warnings.js';

silenceSqliteWarning();

/**
 * UserPromptSubmit: persist the previous turn, then surface relevant memory.
 *
 * Flushing here rather than only at SessionEnd is what makes capture durable.
 * A new prompt is the moment the previous turn is provably finished, and it is
 * the one event guaranteed to fire while a session is alive. Sessions that
 * crash, are force-quit, or simply stay open for days never reach SessionEnd,
 * and under the old design everything they did was lost.
 *
 * Injecting here rather than relying on Claude to call the search tool is the
 * same argument applied to reading: recall that happens, not recall that might.
 */
await runHook(async () => {
  const payload = await readPayload();
  const sessionId = payload.session_id;
  if (!sessionId) return;

  const project = resolveProject(payload.cwd);
  const ctx = await createContext();

  try {
    await ctx.store.upsertSession({ id: sessionId, project, startedAt: Date.now() });

    // Capture what just happened before searching, so this session's own work
    // is already available to the query that follows.
    await flushSession(ctx, sessionId, project, payload.transcript_path);

    // Checked before any search so a trivial prompt never constructs the
    // embedding model, which is the expensive part of this hook.
    const prompt = payload.prompt ?? '';
    if (!ctx.config.inject.perPrompt || !isSearchable(prompt)) return;

    const entries = await ctx.search.search({
      text: prompt,
      project,
      limit: ctx.config.inject.promptResults,
    });

    // Fetch full bodies only for the few we intend to expand, never for the
    // whole result set: that is the layer-3 discipline applied to injection.
    const toExpand = entries.slice(0, ctx.config.inject.expandTop);
    const expanded =
      toExpand.length > 0
        ? await ctx.search.getObservations(toExpand.map((entry) => entry.id))
        : [];

    const block = renderPromptContext(
      entries,
      ctx.config.inject.promptMaxChars,
      expanded,
      ctx.config.inject.expandMaxChars,
    );
    if (block) emitContext(`${block}\n`);
  } finally {
    await ctx.close();
  }
});
