import { clearActive } from '../capture/active.js';
import { flushSession } from '../capture/index.js';
import type { HookRun } from './run.js';
import { takeTurnSave } from './turn-job.js';

export async function saveQueuedTurn(
  sessionId: string,
  withContext: HookRun['withContext'],
): Promise<void> {
  const job = takeTurnSave(sessionId);
  if (!job) return;
  await withContext((ctx) =>
    flushSession(ctx, sessionId, job.project, job.transcriptPath, false, job.finalReply),
  );
  if (job.activeToken) clearActive(sessionId, job.activeToken);
}
