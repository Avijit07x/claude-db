#!/usr/bin/env node
import { activeToken } from '../capture/active.js';
import { loadConfig } from '../config/index.js';
import { resolveProject } from '../util/project.js';
import { TURN_WORKER, runDetached } from './detached.js';
import { capturingDisabled, readPayload, runHook } from './payload.js';
import { queueTurnSave } from './turn-job.js';

await runHook(async () => {
  if (capturingDisabled(loadConfig().capture.scripted)) return;
  const payload = await readPayload();
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
  runDetached(TURN_WORKER, [sessionId], project, () => {});
});
