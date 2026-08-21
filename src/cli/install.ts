import { Scope, instructionsPathFor, mcpPathFor, settingsPathFor, skillPathFor } from './paths.js';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readJson, readText, writeAtomic, writeJson } from './files.js';
import { removeInstructions, writeInstructions } from './instructions.js';
import { rmSync } from 'node:fs';

interface HookMatcher {
  matcher?: string;
  hooks: { type: 'command'; command: string }[];
}

function writeSkill(distDir: string, scope: Scope, project: string): void {
  const source = resolve(distDir, '..', 'skills', 'cdb-scan', 'SKILL.md');
  const body = readText(source);
  if (body.length > 0) writeAtomic(skillPathFor(scope, project), body);
}

function removeSkill(scope: Scope, project: string): void {
  const path = skillPathFor(scope, project);
  rmSync(dirname(path), { recursive: true, force: true });
}

const HOOKS: [event: string, file: string, matcher?: string][] = [
  ['SessionStart', 'session-start.js'],
  ['UserPromptSubmit', 'user-prompt.js'],
  ['SessionEnd', 'session-end.js'],
  ['PreToolUse', 'prefer-usages.js', 'Bash|Grep'],
];

export function assertStableLocation(distDir: string): void {
  const ephemeral = ['_npx', '_cacache'];
  const segments = distDir.split('/');
  if (!ephemeral.some((name) => segments.includes(name))) return;

  throw new Error(
    `Refusing to install from a temporary location:\n  ${distDir}\n\n` +
      `Hooks are registered as absolute paths, and this one will be deleted.\n` +
      `Install persistently first:\n\n` +
      `  npm install -g claude-db\n` +
      `  claude-db install --project\n`,
  );
}

export function install(distDir: string, scope: Scope, project: string): string {
  const path = settingsPathFor(scope, project);
  const settings = readJson(path);
  const hooks = (settings['hooks'] ?? {}) as Record<string, HookMatcher[]>;

  for (const [event, file, matcher] of HOOKS) {
    const kept = (hooks[event] ?? [])
      .map((entry) => ({
        ...entry,
        hooks: entry.hooks.filter((hook) => !isOurHook(hook.command)),
      }))
      .filter((entry) => entry.hooks.length > 0);
    kept.push({
      ...(matcher ? { matcher } : {}),
      hooks: [{ type: 'command', command: hookCommand(distDir, file) }],
    });
    hooks[event] = kept;
  }
  settings['hooks'] = hooks;
  delete settings['mcpServers'];
  writeJson(path, settings);

  const server = resolve(distDir, 'mcp', 'server.js');
  writeInstructions(instructionsPathFor(scope, project));
  writeSkill(distDir, scope, project);

  if (scope === 'global' && registerViaCli(server)) return path;

  const mcpPath = mcpPathFor(scope, project);
  const mcpConfig = readJson(mcpPath);
  const servers = (mcpConfig['mcpServers'] ?? {}) as Record<string, unknown>;
  servers['memory'] = { command: 'node', args: [server] };
  mcpConfig['mcpServers'] = servers;
  writeJson(mcpPath, mcpConfig);

  return path;
}

function claudeMcp(args: string[]): boolean {
  try {
    execFileSync('claude', args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function registerViaCli(server: string): boolean {
  claudeMcp(['mcp', 'remove', 'memory', '-s', 'user']);
  return claudeMcp(['mcp', 'add', 'memory', '-s', 'user', '--', 'node', server]);
}

export function uninstall(distDir: string, scope: Scope, project: string): string | null {
  const path = settingsPathFor(scope, project);
  const settings = readJson(path);
  if (Object.keys(settings).length === 0) return null;

  const hooks = (settings['hooks'] ?? {}) as Record<string, HookMatcher[]>;

  for (const [event, entries] of Object.entries(hooks)) {
    const kept = entries
      .map((entry) => ({
        ...entry,
        hooks: entry.hooks.filter((hook) => !isOurHook(hook.command)),
      }))
      .filter((entry) => entry.hooks.length > 0);

    if (kept.length > 0) hooks[event] = kept;
    else delete hooks[event];
  }
  if (Object.keys(hooks).length > 0) settings['hooks'] = hooks;
  else delete settings['hooks'];
  writeJson(path, settings);

  removeInstructions(instructionsPathFor(scope, project));
  removeSkill(scope, project);

  if (scope === 'global' && claudeMcp(['mcp', 'remove', 'memory', '-s', 'user'])) {
    return path;
  }

  const mcpPath = mcpPathFor(scope, project);
  const mcpConfig = readJson(mcpPath);
  const existed = Object.keys(mcpConfig).length > 0;

  const servers = (mcpConfig['mcpServers'] ?? {}) as Record<string, unknown>;
  delete servers['memory'];
  if (Object.keys(servers).length > 0) mcpConfig['mcpServers'] = servers;
  else delete mcpConfig['mcpServers'];
  if (existed) writeJson(mcpPath, mcpConfig);

  return path;
}

function hookCommand(distDir: string, file: string): string {
  return `node ${resolve(distDir, 'hooks', file)}`;
}

function isOurHook(command: string): boolean {
  const path = command.replace(/\\/g, '/');
  return HOOKS.some(([, file]) => path.endsWith(`/hooks/${file}`));
}
