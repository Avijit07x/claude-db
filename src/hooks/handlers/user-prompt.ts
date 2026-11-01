import { recordActive } from '../../capture/active.js';
import { flushSession, redact } from '../../capture/index.js';
import { loadConfig } from '../../config/index.js';
import { clearPick, startPick } from '../../pick/pending.js';
import { takePick } from '../../pick/run.js';
import { resolveProject } from '../../util/project.js';
import { pickInBackground } from '../background.js';
import { capturingDisabled, emitContext } from '../payload.js';
import { promptCandidates, strictRecall, withCost } from '../prompt-recall.js';
import type { HookRun } from '../run.js';
import { markShown, readShown } from '../shown.js';

export default async function userPrompt(run: HookRun): Promise<void> {
  if (capturingDisabled(loadConfig().capture.scripted, run.env)) return;
  const { payload } = run;
  const sessionId = payload.session_id;
  if (!sessionId) return;

  const project = resolveProject(payload.cwd);
  await run.withContext(async (ctx) => {
    const startedAt = Date.now();
    recordActive(sessionId, project, payload.prompt ?? '');

    const flushed = await flushSession(ctx, sessionId, project, payload.transcript_path);
    const { lastReply } = flushed;
    if (flushed.observations === 0) {
      await ctx.store.upsertSession({ id: sessionId, project, startedAt });
    }

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
    emitContext(withCost(fallback.block), run.write);
  });
}
