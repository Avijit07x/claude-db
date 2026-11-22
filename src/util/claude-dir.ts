import { homedir } from 'node:os';
import { join } from 'node:path';

export function claudeConfigDir(): string {
  const custom = process.env['CLAUDE_CONFIG_DIR'];
  return custom ? custom : join(homedir(), '.claude');
}

export const claudeProjectsDir = (): string => join(claudeConfigDir(), 'projects');
