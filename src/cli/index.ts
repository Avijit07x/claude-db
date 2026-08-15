#!/usr/bin/env node
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flushSession, resetCursor } from '../capture/index.js';
import { createContext } from '../context.js';
import { CONFIG_DIR, CONFIG_PATH, loadConfig, saveConfig } from '../config/index.js';
import { assertStableLocation, install, mcpPathFor, settingsPathFor, uninstall } from './install.js';
import type { Scope } from './install.js';
import { resolveProject } from '../util/project.js';
import { silenceSqliteWarning } from '../util/warnings.js';
import { toShortId } from '../util/shortid.js';

silenceSqliteWarning();

const DIST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'install':
    await cmdInstall(scopeFrom(args));
    break;
  case 'uninstall':
    cmdUninstall(scopeFrom(args));
    break;
  case 'status':
    await cmdStatus();
    break;
  case 'use':
    await cmdUse(args[0]);
    break;
  case 'doctor':
    await cmdDoctor();
    break;
  case 'search':
    await cmdSearch(args.join(' '));
    break;
  case 'flush':
    await cmdFlush();
    break;
  case 'reset':
    await cmdReset(args);
    break;
  case 'projects':
    await cmdProjects();
    break;
  default:
    usage();
}

/** Shows how memory is partitioned, and which partition you are currently in. */
async function cmdProjects(): Promise<void> {
  const here = resolveProject(undefined);
  const ctx = await createContext();

  try {
    const projects = await ctx.store.listProjects();
    if (projects.length === 0) {
      console.log('No memory stored yet.');
      return;
    }

    console.log(`database: ${ctx.config.database}\n`);
    for (const entry of projects) {
      const marker = entry.project === here ? '*' : ' ';
      const date = new Date(entry.lastActive).toISOString().slice(0, 10);
      console.log(
        `${marker} ${String(entry.observations).padStart(5)}  ${date}  ${entry.project}`,
      );
    }
    console.log('\n* is the project you are in now. Searches only ever see one row.');
  } finally {
    await ctx.close();
  }
}

/**
 * Deletes stored memory. Scoped to this project with `--project`, otherwise
 * everything in the configured database.
 *
 * Goes through the adapter rather than deleting a file, because on a shared
 * Postgres or Mongo there is no file to delete and removing the local config
 * directory would silently do nothing.
 */
async function cmdReset(argv: (string | undefined)[]): Promise<void> {
  const scoped = argv.includes('--project') || argv.includes('-p');
  const confirmed = argv.includes('--yes') || argv.includes('-y');
  const project = resolveProject(undefined);

  const ctx = await createContext();
  try {
    const target = scoped ? project : ctx.config.database;

    // Confirmation is checked before the destructive call, not after: a dry
    // run that deletes is worse than having no dry run at all.
    if (!confirmed) {
      console.log(`This would delete ${scoped ? 'this project\'s' : 'ALL'} memory from:`);
      console.log(`  ${target}`);
      console.log('\nNothing was deleted. Re-run with --yes to confirm.');
      return;
    }

    const deleted = await ctx.store.clear(scoped ? project : undefined);
    console.log(`Deleted ${deleted} observation(s) from ${target}.`);
    if (!scoped) {
      clearLocalState();
      console.log('Cleared transcript cursors so the next flush starts clean.');
    }
  } finally {
    await ctx.close();
  }
}

/**
 * Transcript cursors are local scratch state keyed to a database that no
 * longer has the rows. Leaving them behind makes the next flush skip turns it
 * believes were already stored.
 */
function clearLocalState(): void {
  rmSync(join(CONFIG_DIR, 'cursors'), { recursive: true, force: true });
}

/**
 * Ingests every transcript for this project, including sessions still open.
 *
 * Recovery path for anything the hooks missed: sessions that predate the
 * install, sessions that were force-quit, or a database that was wiped. Safe
 * to run repeatedly because observation ids are content-derived.
 */
async function cmdFlush(): Promise<void> {
  const project = resolveProject(undefined);
  const dir = transcriptDirFor(project);

  let files: string[];
  try {
    files = readdirSync(dir).filter((name) => name.endsWith('.jsonl'));
  } catch {
    console.error(`No transcripts found at ${dir}`);
    process.exit(1);
  }

  const ctx = await createContext();
  let total = 0;

  try {
    for (const file of files) {
      const sessionId = file.replace(/\.jsonl$/, '');
      // Ignore any stored cursor: a manual flush is asking for a full re-read.
      resetCursor(sessionId);
      const result = await flushSession(ctx, sessionId, project, join(dir, file));
      if (result.observations > 0) {
        console.log(`${sessionId.slice(0, 8)}  ${String(result.observations).padStart(4)} observations`);
        total += result.observations;
      }
    }
  } finally {
    await ctx.close();
  }

  console.log(`\n${total} observations from ${files.length} transcript(s).`);
}

/** `--project` limits the install to the current repo; default is machine-wide. */
function scopeFrom(args: (string | undefined)[]): Scope {
  return args.includes('--project') || args.includes('-p') ? 'project' : 'global';
}

async function cmdInstall(scope: Scope): Promise<void> {
  const project = resolveProject(undefined);

  try {
    assertStableLocation(DIST_DIR);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const settingsPath = install(DIST_DIR, scope, project);
  const ctx = await createContext();
  await ctx.close();

  console.log(`Scope    : ${scope === 'project' ? `this project only (${project})` : 'all projects on this machine'}`);
  console.log(`Settings : ${settingsPath}`);
  console.log(`Config   : ${CONFIG_PATH}`);
  console.log(`Database : ${ctx.config.database}`);
  console.log('\nRestart Claude Code to activate.');

  if (scope === 'project') {
    warnIfCommittable(project);
    console.log('Remove later with: claude-db uninstall --project');
  }
}

/**
 * `.mcp.json` is conventionally committed so a team shares MCP servers, but
 * ours points at an absolute path under this user's home directory. Committing
 * it hands teammates a server that cannot start. Warn rather than silently
 * editing .gitignore, since that file is the user's to manage.
 */
function warnIfCommittable(project: string): void {
  const gitignore = join(project, '.gitignore');
  let ignored = false;
  try {
    ignored = readFileSync(gitignore, 'utf8')
      .split('\n')
      .some((line) => line.trim().replace(/^\//, '') === '.mcp.json');
  } catch {
    return; // not a git repo, or no .gitignore: nothing to warn about
  }

  if (ignored) return;

  console.log('\nNote: .mcp.json holds an absolute path to this machine.');
  console.log('It would break for anyone else if committed. To keep it local:');
  console.log("  echo '.mcp.json' >> .gitignore");
}

function cmdUninstall(scope: Scope): void {
  const project = resolveProject(undefined);
  const path = uninstall(DIST_DIR, scope, project);
  console.log(
    path
      ? `Removed hooks and MCP server from ${path}`
      : 'Nothing to remove: no settings file found.',
  );
  console.log('Memory itself is untouched. Delete it with: rm -rf ~/.claude-memory');
}

/** Answers "is it actually wired up, and does it have anything in it?" */
async function cmdStatus(): Promise<void> {
  const project = resolveProject(undefined);
  const ctx = await createContext();
  try {
    const sessions = await ctx.store.recentSessions(project, 100);

    // Reading the database says nothing about whether the hooks were ever
    // registered, and "0 sessions" looks identical whether you have not worked
    // yet or never installed. Check both and say which.
    const wiring = [
      { scope: 'project' as const, label: 'this project' },
      { scope: 'global' as const, label: 'all projects' },
    ].map((entry) => ({
      ...entry,
      path: settingsPathFor(entry.scope, project),
      installed: isInstalled(settingsPathFor(entry.scope, project)),
    }));

    const active = wiring.filter((entry) => entry.installed);

    console.log(`project  : ${project}`);
    console.log(`database : ${ctx.config.database}`);
    console.log(
      `hooks    : ${
        active.length > 0
          ? active.map((entry) => entry.label).join(' + ')
          : 'NOT INSTALLED'
      }`,
    );
    const mcpFile = [mcpPathFor('project', project), mcpPathFor('global', project)].find(
      (candidate) => fileMentions(candidate, resolve(DIST_DIR, 'mcp', 'server.js')),
    );
    console.log(`mcp      : ${mcpFile ? `registered (${mcpFile})` : 'NOT REGISTERED'}`);
    console.log(`sessions : ${sessions.length} recorded for this project`);

    if (active.length === 0) {
      console.log('\nHooks are not registered, so nothing will ever be captured.');
      console.log('Run this from the project you want to track:');
      console.log('  claude-db install --project');
    } else if (sessions.length === 0) {
      console.log('\nInstalled, but nothing recorded yet. Memory is written when a');
      console.log('session ENDS. Work in this project, close the session, then re-check.');
      console.log('If you installed just now, restart Claude Code first.');
    }
  } finally {
    await ctx.close();
  }
}

/** True when a settings file contains one of our hook commands. */
function isInstalled(settingsPath: string): boolean {
  return fileMentions(settingsPath, resolve(DIST_DIR, 'hooks', 'session-end.js'));
}

/** Claude Code stores transcripts under a dash-encoded absolute path. */
function transcriptDirFor(project: string): string {
  return join(homedir(), '.claude', 'projects', project.replace(/[/.]/g, '-'));
}

function fileMentions(path: string, needle: string): boolean {
  try {
    return readFileSync(path, 'utf8').includes(needle);
  } catch {
    return false;
  }
}

async function cmdUse(uri: string | undefined): Promise<void> {
  if (!uri) {
    console.error('Usage: claude-db use <connection-string>');
    process.exit(1);
  }
  const config = loadConfig();
  config.database = uri;
  saveConfig(config);

  // Fail loudly here rather than silently at the next SessionStart.
  const ctx = await createContext({ database: uri });
  const ok = await ctx.store.ping();
  await ctx.close();

  console.log(ok ? `Connected. Using ${ctx.store.kind}.` : 'Saved, but ping failed.');
}

async function cmdDoctor(): Promise<void> {
  const ctx = await createContext();
  const reachable = await ctx.store.ping();

  // Report measured capability, not configured intent. Printing "384d" for an
  // embedder that cannot actually run is worse than printing nothing.
  const embedder = await ctx.embedder();
  const vectors = await probeEmbedder(embedder);

  console.log(`database : ${ctx.config.database}`);
  console.log(`adapter  : ${ctx.store.kind}`);
  console.log(`reachable: ${reachable ? 'yes' : 'no'}`);
  console.log(`requested: embeddings.provider = ${ctx.config.embeddings.provider}`);
  console.log(`embedder : ${embedder.id} (${embedder.dimensions}d)`);
  console.log(`vectors  : ${vectors}`);
  console.log(`search   : ${vectors.startsWith('working') ? 'hybrid (keyword + vector)' : 'keyword only'}`);

  await ctx.close();
  process.exit(reachable ? 0 : 1);
}

async function probeEmbedder(embedder: {
  dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}): Promise<string> {
  if (embedder.dimensions === 0) return 'disabled';
  try {
    const [vector] = await embedder.embed(['connectivity probe']);
    return vector && vector.length > 0
      ? `working (${vector.length}d)`
      : 'unavailable (empty vector)';
  } catch (error) {
    return `unavailable (${error instanceof Error ? error.message.split('.')[0] : 'error'})`;
  }
}

async function cmdSearch(query: string): Promise<void> {
  if (!query.trim()) {
    console.error('Usage: claude-db search <query>');
    process.exit(1);
  }
  const ctx = await createContext();
  const results = await ctx.search.search({
    text: query,
    project: resolveProject(undefined),
    limit: 10,
  });
  // Same short-id format the MCP tools emit, so ids copied from either place
  // work in the other.
  for (const entry of results) {
    const date = new Date(entry.createdAt).toISOString().slice(0, 10);
    console.log(`${toShortId(entry.id)}  ${entry.kind.padEnd(10)} ${date}  ${entry.title}`);
  }
  if (results.length === 0) console.log('No matching observations.');
  await ctx.close();
}

function usage(): void {
  console.log(`claude-db

  install [--project]         Register hooks + MCP server with Claude Code
  uninstall [--project]       Remove them again, leaving memory intact
  status                      Is it wired up, and has it recorded anything
  doctor                      Show resolved config and test connectivity
  use <connection-string>     Point memory at any database and verify it
  search <query>              Search memory for the current project
  projects                    List every project with memory in this database
  flush                       Re-ingest every transcript for this project
  reset [--project] --yes     Delete stored memory (dry run without --yes)

  --project  scope to the current repo via .claude/settings.local.json
             instead of every project on this machine

Connection strings:
  mongodb+srv://user:pass@cluster.mongodb.net/memory
  postgres://user:pass@host:5432/memory
  /path/to/memory.db                          (SQLite, default)

Or set CLAUDE_DB_URL in the environment to override config.json.`);
}
