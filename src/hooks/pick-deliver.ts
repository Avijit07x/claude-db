#!/usr/bin/env node
import { takeReady } from '../pick/pending.js';
import { emitToolContext, readPayload, runHook } from './payload.js';
import { markShown } from './shown.js';

await runHook(async () => {
  if (process.env['CLAUDE_DB_CAPTURE'] === 'off') return;
  const sessionId = (await readPayload()).session_id;
  if (!sessionId) return;

  const ready = takeReady(sessionId);
  if (!ready) return;

  markShown(sessionId, ready.ids);
  emitToolContext(ready.text);
});
