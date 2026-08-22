#!/usr/bin/env node
import { flushSession } from '../capture/index.js';
import { createContext } from '../context.js';
import { emitContext, readPayload, runHook } from './payload.js';
import { markShown, readShown } from './shown.js';
import { overlapCount, renderPromptContext } from './relevance.js';
import { isSearchable } from '../util/prompt.js';
import { resolveProject } from '../util/project.js';
import { silenceSqliteWarning } from '../util/warnings.js';

silenceSqliteWarning();

await runHook(async () => {
  const payload = await readPayload();
  const sessionId = payload.session_id;
  if (!sessionId) return;

  const project = resolveProject(payload.cwd);
  const ctx = await createContext();

  try {
    await ctx.store.upsertSession({ id: sessionId, project, startedAt: Date.now() });

    await flushSession(ctx, sessionId, project, payload.transcript_path);

    const prompt = payload.prompt ?? '';
    if (!ctx.config.inject.perPrompt || !isSearchable(prompt)) return;

    const shown = readShown(sessionId);
    const found = await ctx.search.search({
      text: prompt,
      project,
      limit: ctx.config.inject.promptResults,
    });

    const floor = ctx.config.inject.minOverlap;
    const entries = found
      .filter((entry) => !shown.has(entry.id))
      .filter((entry) => floor === 0 || overlapCount(prompt, entry) >= floor);
    if (entries.length === 0) return;

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
    if (!block) return;
    markShown(
      sessionId,
      entries.map((entry) => entry.id),
    );
    emitContext(`${block}\n(context ≈ ${Math.round(block.length / 4)} tokens)\n`);
  } finally {
    await ctx.close();
  }
});
