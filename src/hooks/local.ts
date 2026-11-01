import { createContext } from '../context.js';
import { silenceSqliteWarning } from '../util/warnings.js';
import { parsePayload, writeStdout } from './payload.js';
import type { HookName } from './run.js';
import { loadHandler } from './run.js';

export async function runLocally(name: HookName, raw: string): Promise<void> {
  silenceSqliteWarning();
  const handle = await loadHandler(name);
  await handle({
    payload: parsePayload(raw),
    env: process.env,
    write: writeStdout,
    async withContext(work) {
      const ctx = await createContext();
      try {
        return await work(ctx);
      } finally {
        await ctx.close();
      }
    },
    inDaemon: () => false,
  });
}
