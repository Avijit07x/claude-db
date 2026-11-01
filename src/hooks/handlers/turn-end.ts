import { activeToken } from '../../capture/active.js';
import { loadConfig } from '../../config/index.js';
import { resolveProject } from '../../util/project.js';
import { TURN_WORKER, runDetached } from '../detached.js';
import { capturingDisabled } from '../payload.js';
import type { HookRun } from '../run.js';
import { saveQueuedTurn } from '../save-turn.js';
import { queueTurnSave } from '../turn-job.js';

export default function turnEnd(run: HookRun): Promise<void> {
  if (!capturingDisabled(loadConfig().capture.scripted, run.env)) queue(run);
  return Promise.resolve();
}

function queue(run: HookRun): void {
  const { payload } = run;
  const sessionId = payload.session_id;
  if (!sessionId) return;

  const project = resolveProject(payload.cwd);
  const tasks = Array.isArray(payload.background_tasks) ? payload.background_tasks : [];
  const crons = Array.isArray(payload.session_crons) ? payload.session_crons : [];
  const stillWorking = crons.length > 0 || tasks.some((task) => task?.status === 'running');
  queueTurnSave(sessionId, {
    project,
    ...(payload.transcript_path ? { transcriptPath: payload.transcript_path } : {}),
    finalReply: payload.last_assistant_message ?? '',
    activeToken: stillWorking ? null : activeToken(sessionId),
  });
  if (run.inDaemon(() => saveQueuedTurn(sessionId, run.withContext))) return;
  runDetached(TURN_WORKER, [sessionId], project, () => {});
}
