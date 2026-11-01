import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearActive, sweepActive } from '../../capture/active.js';
import {
  aiSummary,
  flushSession,
  observationsFromTurns,
  readTranscript,
  transcriptPathFor,
} from '../../capture/index.js';
import { loadConfig } from '../../config/index.js';
import { distillBlocked } from '../../facts/budget.js';
import { clearPick, sweepPicks } from '../../pick/pending.js';
import { isDue, readState } from '../../update.js';
import { resolveProject } from '../../util/project.js';
import { distillInBackground } from '../background.js';
import { capturingDisabled } from '../payload.js';
import type { HookRun } from '../run.js';
import { dropTurnSave, sweepTurnSaves } from '../turn-job.js';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cli', 'index.js');

export default async function sessionEnd(run: HookRun): Promise<void> {
  if (capturingDisabled(loadConfig().capture.scripted, run.env)) return;
  const { payload } = run;
  const sessionId = payload.session_id;
  if (!sessionId) return;

  const project = resolveProject(payload.cwd);
  await run.withContext(async (ctx) => {
    const result = await flushSession(ctx, sessionId, project, payload.transcript_path);

    let summary = result.summary;
    if (!ctx.config.distill.enabled && ctx.config.capture.summarize === 'on') {
      const path = payload.transcript_path ?? transcriptPathFor(project, sessionId);
      const { turns } = readTranscript(path, 0);
      const observations = observationsFromTurns(turns, sessionId, project, ctx.config);
      const ai = await aiSummary(
        observations.map((obs) => `${obs.title}\n${obs.body}`).join('\n\n'),
        ctx.config.capture.summarizeModel,
      );
      if (ai) summary = `AI: ${ai}`;
    }

    await ctx.store.upsertSession({
      id: sessionId,
      project,
      startedAt: Date.now(),
      endedAt: Date.now(),
      ...(summary ? { summary } : {}),
    });

    clearPick(sessionId);
    sweepPicks();
    dropTurnSave(sessionId);
    sweepTurnSaves();
    clearActive(sessionId);
    sweepActive();
    const { distill } = ctx.config;
    if (distill.enabled && !distillBlocked(distill.dailyLimit)) {
      distillInBackground(project, sessionId);
    }

    if (ctx.config.updates !== 'off' && isDue(readState())) {
      spawn(process.execPath, [CLI, 'update', '--quiet'], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    }
  });
}
