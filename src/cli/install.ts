import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
 * Where standing instructions go.
 *
 * Hook output is injected as conversation context, which the agent reads as
 * information about the current turn. It is not a rule, so "you could search
 * memory" competes with everything else in the transcript and loses. A memory
 * file is part of the system prompt and governs the whole session, which is
 * the only reliable way to make recall a default rather than a suggestion.
 *
 * Project scope writes CLAUDE.local.md rather than CLAUDE.md: it is personal
 * and uncommitted, matching settings.local.json, so installing memory for
 * yourself never tells a teammate's agent to call a server they do not have.
 */
export function instructionsPathFor(scope: Scope, project: string): string {
  return scope === 'project'
    ? join(project, 'CLAUDE.local.md')
    : join(homedir(), '.claude', 'CLAUDE.md');
}

const BLOCK_START = '<!-- claude-db:start -->';
const BLOCK_END = '<!-- claude-db:end -->';

const INSTRUCTIONS = [
  BLOCK_START,
  '## Project memory',
  '',
  'This project has persistent memory of past sessions, served by the `memory`',
  'MCP server. Session summaries are injected at startup and the best matching',
  'observation is injected above each prompt, but that is only ever a slice.',
  '',
  'Before saying you lack context on this codebase, or asking the user to',
  're-explain a past decision, a failed approach, or why something is the way',
  'it is: call `search` first, then `get_observations` for the ids worth',
  'reading. Treat asking the user as the fallback, not the first move.',
  '',
  'When the user states a standing rule or preference, record it with',
  '`remember` so it survives this session.',
  BLOCK_END,
].join('\n');

/** Adds or refreshes our block, leaving everything else in the file intact. */
function writeInstructions(path: string): void {
  const rest = withoutBlock(readText(path)).trimEnd();
  const body = rest.length > 0 ? `${rest}\n\n${INSTRUCTIONS}\n` : `${INSTRUCTIONS}\n`;
  writeAtomic(path, body);
}

function removeInstructions(path: string): void {
  const existing = readText(path);
  if (!existing.includes(BLOCK_START)) return;

  const rest = withoutBlock(existing).trim();
  // A file that held nothing but our block was ours to create, so take it with
  // us rather than leaving an empty CLAUDE.md behind.
  if (rest.length === 0) rmSync(path, { force: true });
  else writeAtomic(path, `${rest}\n`);
}

function withoutBlock(text: string): string {
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END);
  if (start === -1 || end === -1 || end < start) return text;
  return `${text.slice(0, start)}${text.slice(end + BLOCK_END.length)}`.replace(/\n{3,}/g, '\n\n');
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
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
 * Registers the three lifecycle hooks and the MCP server, merging into whatever
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

  const server = resolve(distDir, 'mcp', 'server.js');
  writeInstructions(instructionsPathFor(scope, project));

  // A global install lands in ~/.claude.json, which holds all of Claude Code's
  // own state. Let its CLI own that file rather than round-tripping megabytes
  // of someone else's config through JSON.parse to add one key. The direct
  // write stays as a fallback, since `claude` is not always on PATH, and it is
  // the right thing for the project scope: .mcp.json is small and ours.
  if (scope === 'global' && registerViaCli(server)) return path;

  const mcpPath = mcpPathFor(scope, project);
  const mcpConfig = readJson(mcpPath);
  const servers = (mcpConfig['mcpServers'] ?? {}) as Record<string, unknown>;
  servers['memory'] = { command: 'node', args: [server] };
  mcpConfig['mcpServers'] = servers;
  writeJson(mcpPath, mcpConfig);

  return path;
}

/** Both directions of the `claude mcp` CLI, false when it is unavailable. */
function claudeMcp(args: string[]): boolean {
  try {
    execFileSync('claude', args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function registerViaCli(server: string): boolean {
  // Removed first because `add` refuses an existing name, and re-running
  // install has to stay safe.
  claudeMcp(['mcp', 'remove', 'memory', '-s', 'user']);
  return claudeMcp(['mcp', 'add', 'memory', '-s', 'user', '--', 'node', server]);
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

  removeInstructions(instructionsPathFor(scope, project));

  // Symmetric with install: if the CLI put it there, the CLI takes it out.
  if (scope === 'global' && claudeMcp(['mcp', 'remove', 'memory', '-s', 'user'])) {
    return path;
  }

  const mcpPath = mcpPathFor(scope, project);
  const mcpConfig = readJson(mcpPath);
  // Captured before the delete below can empty it. Testing emptiness
  // afterwards skipped the write for a config holding only our server, which
  // is the common case, so uninstall silently left it registered.
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

function readJson(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Written through a temporary file and renamed, because one of these targets
 * is `~/.claude.json`, which holds all of Claude Code's own state. Truncating
 * it and dying midway to add a single key would cost the user real data;
 * rename is atomic, so the file is either the old one or the new one.
 */
function writeJson(path: string, value: unknown): void {
  writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, content, 'utf8');
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}
