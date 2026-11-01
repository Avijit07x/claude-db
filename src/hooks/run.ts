import type { RecallContext } from '../context.js';
import type { HookEnv, HookPayload, Write } from './payload.js';

export interface HookRun {
  payload: HookPayload;
  env: HookEnv;
  write: Write;
  withContext: <T>(work: (ctx: RecallContext) => Promise<T>) => Promise<T>;
  inDaemon: (task: () => Promise<void>) => boolean;
}

export type HookHandler = (run: HookRun) => Promise<void>;

export const HOOKS = [
  'session-start',
  'user-prompt',
  'prefer-usages',
  'turn-end',
  'session-end',
] as const;

export type HookName = (typeof HOOKS)[number];

export const isHookName = (value: unknown): value is HookName =>
  typeof value === 'string' && (HOOKS as readonly string[]).includes(value);

export async function loadHandler(name: HookName): Promise<HookHandler> {
  const loaded = (await import(`./handlers/${name}.js`)) as { default: HookHandler };
  return loaded.default;
}
