import { Scope, instructionsPathFor, mcpPathFor, settingsPathFor } from './paths.js';
import type { SkillInstallResult } from './skills.js';
import { installSkills, removeSkills } from './skills.js';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readJson, writeJson, writeJsonOrRemove } from './files.js';
import { removeInstructions, writeInstructions } from './instructions.js';
import { toPosix } from '../util/paths.js';

interface HookMatcher {
  matcher?: string;
  hooks: { type: 'command'; command: string; timeout?: number }[];
}

const HOOKS: [event: string, file: string, matcher?: string | undefined, timeout?: number][] = [
  ['SessionStart', 'session-start.js'],
  ['UserPromptSubmit', 'user-prompt.js'],
  ['SessionEnd', 'session-end.js'],
  ['PreToolUse', 'prefer-usages.js', 'Bash|Grep', 10],
  ['PreToolUse', 'pick-deliver.js', undefined, 5],
];

export function assertStableLocation(distDir: string): void {
  const ephemeral = ['_npx', '_cacache'];
  const segments = toPosix(distDir).split('/');
  if (!ephemeral.some((name) => segments.includes(name))) return;

  throw new Error(
    `Refusing to install from a temporary location:\n  ${distDir}\n\n` +
      `Hooks are registered as absolute paths, and this one will be deleted.\n` +
      `Install persistently first:\n\n` +
      `  npm install -g claude-db\n` +
      `  claude-db install --project\n`,
  );
}

function withoutOurHooks(entries: HookMatcher[]): HookMatcher[] {
  return entries
    .map((entry) => ({
      ...entry,
      hooks: entry.hooks.filter((hook) => !isOurHook(hook.command)),
    }))
    .filter((entry) => entry.hooks.length > 0);
}

function withOurHooks(
  hooks: Record<string, HookMatcher[]>,
  distDir: string,
): Record<string, HookMatcher[]> {
  const merged: Record<string, HookMatcher[]> = {};
  for (const [event, entries] of Object.entries(hooks)) {
    const kept = withoutOurHooks(entries);
    if (kept.length > 0) merged[event] = kept;
  }
  for (const [event, file, matcher, timeout] of HOOKS) {
    (merged[event] ??= []).push({
      ...(matcher ? { matcher } : {}),
      hooks: [
        {
          type: 'command',
          command: hookCommand(distDir, file),
          ...(timeout ? { timeout } : {}),
        },
      ],
    });
  }
  return merged;
}

export function refreshHooks(distDir: string, path: string): boolean {
  const settings = readJson(path);
  const hooks = (settings['hooks'] ?? {}) as Record<string, HookMatcher[]>;
  const ours = Object.values(hooks)
    .flatMap((entries) => entries.flatMap((entry) => entry.hooks.map((hook) => hook.command)))
    .filter(isOurHook);
  const here = `${hookCommand(distDir, '')}/`;
  if (ours.length === 0 || !ours.every((command) => command.startsWith(here))) return false;

  const merged = withOurHooks(hooks, distDir);
  if (JSON.stringify(merged) === JSON.stringify(hooks)) return false;
  writeJson(path, { ...settings, hooks: merged });
  return true;
}

export interface InstallResult {
  settingsPath: string;
  skills: SkillInstallResult[];
}

export function install(distDir: string, scope: Scope, project: string): InstallResult {
  const path = settingsPathFor(scope, project);
  const settings = readJson(path);
  settings['hooks'] = withOurHooks(
    (settings['hooks'] ?? {}) as Record<string, HookMatcher[]>,
    distDir,
  );
  delete settings['mcpServers'];
  writeJson(path, settings);

  const server = resolve(distDir, 'mcp', 'server.js');
  writeInstructions(instructionsPathFor(scope, project));
  const skills = installSkills(distDir, scope, project);

  if (scope === 'global' && registerViaCli(server)) return { settingsPath: path, skills };

  const mcpPath = mcpPathFor(scope, project);
  const mcpConfig = readJson(mcpPath);
  const servers = (mcpConfig['mcpServers'] ?? {}) as Record<string, unknown>;
  servers['memory'] = { command: 'node', args: [server] };
  mcpConfig['mcpServers'] = servers;
  writeJson(mcpPath, mcpConfig);

  return { settingsPath: path, skills };
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

  const save = scope === 'project' ? writeJsonOrRemove : writeJson;
  const hooks = (settings['hooks'] ?? {}) as Record<string, HookMatcher[]>;

  for (const [event, entries] of Object.entries(hooks)) {
    const kept = withoutOurHooks(entries);

    if (kept.length > 0) hooks[event] = kept;
    else delete hooks[event];
  }
  if (Object.keys(hooks).length > 0) settings['hooks'] = hooks;
  else delete settings['hooks'];
  save(path, settings);

  removeInstructions(instructionsPathFor(scope, project));
  removeSkills(scope, project);

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
  if (existed) save(mcpPath, mcpConfig);

  return path;
}

function hookCommand(distDir: string, file: string): string {
  return `node ${toPosix(resolve(distDir, 'hooks', file))}`;
}

export function ourHookFile(command: string): string | null {
  const path = toPosix(command);
  return HOOKS.find(([, file]) => path.endsWith(`/hooks/${file}`))?.[1] ?? null;
}

function isOurHook(command: string): boolean {
  return ourHookFile(command) !== null;
}
