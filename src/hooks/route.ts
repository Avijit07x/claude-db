import { readStdin, runHook } from './payload.js';
import type { HookName } from './run.js';

export async function routeHook(name: HookName): Promise<void> {
  await runHook(async () => {
    const raw = await readStdin();
    const { runLocally } = await import('./local.js');
    await runLocally(name, raw);
  });
}
