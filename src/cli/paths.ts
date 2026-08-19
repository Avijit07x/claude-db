import { homedir } from 'node:os';
import { join } from 'node:path';

export type Scope = 'global' | 'project';

export function settingsPathFor(scope: Scope, project: string): string {
  return scope === 'project'
    ? join(project, '.claude', 'settings.local.json')
    : join(homedir(), '.claude', 'settings.json');
}

export function instructionsPathFor(scope: Scope, project: string): string {
  return scope === 'project'
    ? join(project, 'CLAUDE.local.md')
    : join(homedir(), '.claude', 'CLAUDE.md');
}

export function skillPathFor(scope: Scope, project: string): string {
  const root = scope === 'project' ? join(project, '.claude') : join(homedir(), '.claude');
  return join(root, 'skills', 'cdb-scan', 'SKILL.md');
}

export function mcpPathFor(scope: Scope, project: string): string {
  return scope === 'project' ? join(project, '.mcp.json') : join(homedir(), '.claude.json');
}
