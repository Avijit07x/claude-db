#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearCursor, flushSession } from '../capture/index.js';
import { isDue, readState } from '../update.js';
import { createContext } from '../context.js';
import { readPayload, runHook } from './payload.js';
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
    const result = await flushSession(ctx, sessionId, project, payload.transcript_path);

    await ctx.store.upsertSession({
      id: sessionId,
      project,
      startedAt: Date.now(),
      endedAt: Date.now(),
      ...(result.summary ? { summary: result.summary } : {}),
    });

    clearCursor(sessionId);

    if (ctx.config.updates !== 'off' && isDue(readState())) {
      const cli = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'index.js');
      spawn(process.execPath, [cli, 'update', '--quiet'], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    }
  } finally {
    await ctx.close();
  }
});
