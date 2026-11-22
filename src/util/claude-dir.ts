import { homedir } from 'node:os';
import { join } from 'node:path';
import { hookEnv } from './env.js';

export function claudeConfigDir(): string {
  const custom = hookEnv()['CLAUDE_CONFIG_DIR'];
  return custom ? custom : join(homedir(), '.claude');
}

export const claudeProjectsDir = (): string => join(claudeConfigDir(), 'projects');
