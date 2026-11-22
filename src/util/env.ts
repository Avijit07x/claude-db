import { AsyncLocalStorage } from 'node:async_hooks';

const requests = new AsyncLocalStorage<NodeJS.ProcessEnv>();

export const hookEnv = (): NodeJS.ProcessEnv => requests.getStore() ?? process.env;

export function withHookEnv<T>(env: NodeJS.ProcessEnv | undefined, work: () => T): T {
  return env ? requests.run(env, work) : work();
}
