import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

interface HookMatcher {
  matcher?: string;
  hooks: { type: 'command'; command: string }[];
}

export type Scope = 'global' | 'project';

/**
 * Where Claude Code reads settings from.
 *
 * `project` writes `settings.local.json` inside the target repo, which Claude
 * Code already treats as personal and gitignores. That makes it the right
 * choice for trying memory on one repo without touching every session on the
 * machine, and it is trivially reversible by deleting one file.
 */
export function settingsPathFor(scope: Scope, project: string): string {
  return scope === 'project'
    ? join(project, '.claude', 'settings.local.json')
    : join(homedir(), '.claude', 'settings.json');
}

/**
 * MCP servers live in a different file from hooks.
 *
 * Claude Code reads project-scoped MCP servers from `.mcp.json` at the repo
 * root, not from `settings.local.json`. Writing them alongside the hooks looks
 * correct and silently does nothing: the hooks fire, the tools never appear,
 * and the session-start text ends up advertising tools that do not exist.
 */
export function mcpPathFor(scope: Scope, project: string): string {
  return scope === 'project'
    ? join(project, '.mcp.json')
    : join(homedir(), '.claude.json');
}

/**
 * Three hooks, not four.
 *
 * There is deliberately no PostToolUse hook. It fired after every single tool
 * call and existed only to journal file paths, which the transcript already
 * records in far more detail. Removing it deletes the most frequently invoked
 * process in the system and loses nothing.
 */
const HOOKS: [event: string, file: string, matcher?: string][] = [
  ['SessionStart', 'session-start.js'],
  ['UserPromptSubmit', 'user-prompt.js'],
  ['SessionEnd', 'session-end.js'],
];

/**
 * Registers the four lifecycle hooks and the MCP server, merging into whatever
 * the user already has rather than overwriting it. Re-running is safe: a hook
 * whose command already appears is skipped rather than duplicated.
 */
/**
 * Refuses to install from a location that will not survive.
 *
 * Hooks are registered as absolute paths to this build. `npx` unpacks into
 * `~/.npm/_npx/<hash>/`, which npm evicts on its own schedule, so an install
 * from there works until the cache is cleared and then fails silently on every
 * hook forever after. Failing loudly now is far better than a memory system
 * that quietly stops recording weeks later.
 */
export function assertStableLocation(distDir: string): void {
  // Only npm's own scratch areas. Matching on `/tmp/` generally would be a
  // false positive: a global prefix can legitimately live anywhere, and
  // refusing a valid install is worse than the problem being guarded against.
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
    const command = hookCommand(distDir, file);
    const existing = hooks[event] ?? [];
    const present = existing.some((entry) =>
      entry.hooks.some((hook) => hook.command === command),
    );
    if (present) continue;
    existing.push({
      ...(matcher ? { matcher } : {}),
      hooks: [{ type: 'command', command }],
    });
    hooks[event] = existing;
  }
  settings['hooks'] = hooks;
  // Never write mcpServers here; Claude Code ignores it in this file.
  delete settings['mcpServers'];
  writeJson(path, settings);

  const mcpPath = mcpPathFor(scope, project);
  const mcpConfig = readJson(mcpPath);
  const servers = (mcpConfig['mcpServers'] ?? {}) as Record<string, unknown>;
  servers['memory'] = {
    command: 'node',
    args: [resolve(distDir, 'mcp', 'server.js')],
  };
  mcpConfig['mcpServers'] = servers;
  writeJson(mcpPath, mcpConfig);

  return path;
}

/**
 * Removes only what `install` added, leaving unrelated hooks and servers in
 * place. Empty containers are pruned so an uninstall leaves no residue.
 */
export function uninstall(distDir: string, scope: Scope, project: string): string | null {
  const path = settingsPathFor(scope, project);
  const settings = readJson(path);
  if (Object.keys(settings).length === 0) return null;

  const ours = new Set(HOOKS.map(([, file]) => hookCommand(distDir, file)));
  const hooks = (settings['hooks'] ?? {}) as Record<string, HookMatcher[]>;

  for (const [event, entries] of Object.entries(hooks)) {
    const kept = entries
      .map((entry) => ({
        ...entry,
        hooks: entry.hooks.filter((hook) => !ours.has(hook.command)),
      }))
      .filter((entry) => entry.hooks.length > 0);

    if (kept.length > 0) hooks[event] = kept;
    else delete hooks[event];
  }
  if (Object.keys(hooks).length > 0) settings['hooks'] = hooks;
  else delete settings['hooks'];
  writeJson(path, settings);

  const mcpPath = mcpPathFor(scope, project);
  const mcpConfig = readJson(mcpPath);
  const servers = (mcpConfig['mcpServers'] ?? {}) as Record<string, unknown>;
  delete servers['memory'];
  if (Object.keys(servers).length > 0) mcpConfig['mcpServers'] = servers;
  else delete mcpConfig['mcpServers'];
  if (Object.keys(mcpConfig).length > 0) writeJson(mcpPath, mcpConfig);

  return path;
}

function hookCommand(distDir: string, file: string): string {
  return `node ${resolve(distDir, 'hooks', file)}`;
}

function readJson(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
