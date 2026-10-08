#!/usr/bin/env node
import { recordActive } from '../capture/active.js';
import { flushSession, redact } from '../capture/index.js';
import { createContext } from '../context.js';
import { capturingDisabled, emitContext, readPayload, runHook } from './payload.js';
import { loadConfig } from '../config/index.js';
import { markShown, readShown } from './shown.js';
import { promptCandidates, strictRecall, withCost } from './prompt-recall.js';
import { pickInBackground } from './background.js';
import { clearPick, startPick } from '../pick/pending.js';
import { takePick } from '../pick/run.js';
import { resolveProject } from '../util/project.js';
import { silenceSqliteWarning } from '../util/warnings.js';

silenceSqliteWarning();

await runHook(async () => {
  if (capturingDisabled(loadConfig().capture.scripted)) return;
  const payload = await readPayload();
  const sessionId = payload.session_id;
  if (!sessionId) return;

  const project = resolveProject(payload.cwd);
  const ctx = await createContext();

  try {
    await ctx.store.upsertSession({ id: sessionId, project, startedAt: Date.now() });
    recordActive(sessionId, project, payload.prompt ?? '');

    const { lastReply } = await flushSession(ctx, sessionId, project, payload.transcript_path);

    const candidates = await promptCandidates(ctx, {
      prompt: payload.prompt ?? '',
      project,
      sessionId,
      shown: readShown(sessionId),
    });
    if (!candidates) {
      clearPick(sessionId);
      return;
    }

    const fallback = await strictRecall(ctx, candidates);
    if (takePick(ctx.config)) {
      const token = startPick(sessionId, {
        project,
        prompt: redact(candidates.prompt),
        previousReply: redact(lastReply),
        ids: candidates.entries.map((entry) => entry.id),
        fallback: fallback ? { text: withCost(fallback.block), ids: fallback.ids } : null,
      });
      pickInBackground(project, sessionId, token);
      return;
    }

    clearPick(sessionId);
    if (!fallback) return;
    markShown(sessionId, fallback.ids);
    emitContext(withCost(fallback.block));
  } finally {
    await ctx.close();
  }
});
