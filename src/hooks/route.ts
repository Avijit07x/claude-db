import { askDaemon, daemonWanted, forwardedEnv, startDaemon, workerEnv } from '../daemon/client.js';
import { buildId } from '../daemon/paths.js';
import { readStdin, runHook } from './payload.js';
import type { HookName } from './run.js';

const WAIT_MS: Partial<Record<HookName, number>> = { 'prefer-usages': 8_000 };
const DEFAULT_WAIT_MS = 50_000;

async function viaDaemon(name: HookName, raw: string): Promise<boolean> {
  if (!daemonWanted()) return false;
  const asked = await askDaemon(
    { build: buildId(), hook: name, raw, env: forwardedEnv(), workerEnv: workerEnv() },
    WAIT_MS[name] ?? DEFAULT_WAIT_MS,
  );
  if (asked.kind === 'done') {
    if (asked.out.length > 0) process.stdout.write(asked.out);
    return true;
  }
  if (asked.kind === 'timeout') return true;
  startDaemon();
  return false;
}

export async function routeHook(name: HookName): Promise<void> {
  await runHook(async () => {
    const raw = await readStdin();
    if (await viaDaemon(name, raw)) return;
    const { runLocally } = await import('./local.js');
    await runLocally(name, raw);
  });
}
