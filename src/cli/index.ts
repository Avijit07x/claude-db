#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  embedObservations,
  flushSession,
  remember,
  observationsFromGit,
  redact,
  resetCursor,
  sweepCursors,
  transcriptsFor,
} from '../capture/index.js';
import { createContext } from '../context.js';
import type { RecallContext } from '../context.js';
import { createStore } from '../store/index.js';
import type { MemoryStore } from '../store/index.js';
import type { Observation, ObservationKind } from '../types.js';
import { CONFIG_DIR, CONFIG_PATH, loadConfig, saveConfig } from '../config/index.js';
import {
  assertStableLocation,
  install,
  instructionsPathFor,
  mcpPathFor,
  settingsPathFor,
  skillPathFor,
  uninstall,
} from './install.js';
import type { Scope } from './install.js';
import { resolveProject } from '../util/project.js';
import { checkForUpdate, packageVersion } from '../update.js';
import { silenceSqliteWarning } from '../util/warnings.js';
import { toShortId } from '../util/shortid.js';

silenceSqliteWarning();

const DIST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Declared above the command switch below, which runs before the rest of this
// module's bindings initialise.
const BATCH = 500;

/**
 * How far capture may lag the work before it counts as broken.
 *
 * Not every turn produces an observation — a day of questions legitimately
 * records nothing — so a tight threshold would cry wolf. Two full days of
 * activity with nothing written is the shape every silent failure so far had.
 */
const STALL_MS = 48 * 60 * 60 * 1000;

const [command, ...args] = process.argv.slice(2);

// Every command runs inside this. A driver that cannot reach its database
// rejects deep inside an adapter, and with nothing catching it the CLI printed
// a twenty-line Node stack trace at the user instead of saying what went wrong.
try {
  await run();
} catch (error) {
  console.error(`claude-db: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

async function run(): Promise<void> {
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
    await cmdUse(args);
    break;
  case 'doctor':
    await cmdDoctor(args);
    break;
  case 'search':
    await cmdSearch(args);
    break;
  case 'remember':
    await cmdRemember(args);
    break;
  case 'forget':
    await cmdForget(args);
    break;
  case 'export':
    await cmdExport(args);
    break;
  case 'import':
    await cmdImport(args[0]);
    break;
  case 'prune':
    await cmdPrune(args);
    break;
  case 'reembed':
    await cmdReembed();
    break;
  case 'stats':
    await cmdStats();
    break;
  case 'update':
    await cmdUpdate(args);
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
  case 'merge':
    await cmdMerge(args);
    break;
  case 'seed':
    await cmdSeed(args);
    break;
  case 'sync':
    await cmdSync(args);
    break;
  default:
    usage();
}
}

/**
 * Fills a cold memory from the history the repository already holds.
 *
 * The first weeks after an install are the worst time to be asking anyone to
 * trust this: there is nothing in it, so every search comes back empty and the
 * habit never forms. Git history is the one source available on day one, and
 * unlike a generated summary it records what actually happened.
 */
async function cmdSeed(argv: (string | undefined)[]): Promise<void> {
  if (!argv.includes('--from-git')) {
    console.error('Usage: claude-db seed --from-git [--limit <n>]');
    process.exit(1);
  }

  const limit = Number(valueOf(argv, '--limit') ?? 500);
  if (!Number.isFinite(limit) || limit <= 0) {
    console.error('--limit must be a positive number of commits.');
    process.exit(1);
  }

  const project = resolveProject(undefined);
  let observations: Observation[];
  try {
    observations = observationsFromGit(project, limit);
  } catch (error) {
    console.error(`Could not read git history: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    process.exit(1);
  }

  if (observations.length === 0) {
    console.log(`No usable commits found in ${project}.`);
    console.log('Merges, releases and commits touching no files are skipped.');
    return;
  }

  const ctx = await createContext();
  try {
    for (let i = 0; i < observations.length; i += BATCH) {
      const batch = observations.slice(i, i + BATCH);
      await embedObservations(ctx, batch);
      await ctx.store.insertObservations(batch);
    }
  } finally {
    await ctx.close();
  }

  // Ids come from the commit sha, so this is safe to repeat as history grows.
  console.log(`Seeded ${observations.length} observation(s) from git history.`);
  console.log(`Oldest: ${new Date(observations[observations.length - 1]?.createdAt ?? 0).toISOString().slice(0, 10)}`);
}

/**
 * Two-way merge with another database.
 *
 * `export`/`import` only ever moves memory one way, which makes the second
 * machine a copy rather than a peer. Content-derived ids make the real thing
 * nearly free: an id present on one side and not the other is, by construction,
 * memory the other side has never seen, so the merge needs no clocks, no
 * conflict rules and no ordering.
 */
async function cmdSync(argv: (string | undefined)[]): Promise<void> {
  const url = argv.find((arg) => typeof arg === 'string' && !arg.startsWith('-'));
  const confirmed = argv.includes('--yes') || argv.includes('-y');

  if (!url) {
    console.error('Usage: claude-db sync <connection-string> [--yes]');
    process.exit(1);
  }

  const local = await createContext();
  if (local.config.database === url) {
    await local.close();
    console.error('That is the database memory already uses.');
    process.exit(1);
  }

  const remote = await createStore(url);
  try {
    await remote.init();

    // Ids only from the first pass. Holding both databases in memory at once
    // is what would stop this working on the shared backend it exists for.
    const localIds = new Set<string>();
    await eachRemoteObservation(local.store, (batch) => {
      for (const obs of batch) localIds.add(obs.id);
    });

    const remoteIds = new Set<string>();
    let pulled = 0;
    await eachRemoteObservation(remote, async (batch) => {
      for (const obs of batch) remoteIds.add(obs.id);
      const fresh = batch.filter((obs) => !localIds.has(obs.id));
      if (fresh.length === 0) return;
      pulled += fresh.length;
      if (confirmed) await local.store.insertObservations(fresh);
    });

    let pushed = 0;
    await eachRemoteObservation(local.store, async (batch) => {
      const fresh = batch.filter((obs) => !remoteIds.has(obs.id));
      if (fresh.length === 0) return;
      pushed += fresh.length;
      if (confirmed) await remote.insertObservations(fresh);
    });

    if (!confirmed) {
      console.log(`This would pull ${pulled} and push ${pushed} observation(s).`);
      console.log('\nNothing was transferred. Re-run with --yes to confirm.');
      return;
    }

    // Sessions carry the recap injected at SessionStart, so memory that
    // arrives without them reads as a pile of turns with no shape.
    const sessions = await syncSessions(local.store, remote);
    console.log(`Pulled ${pulled}, pushed ${pushed}, and reconciled ${sessions} session(s).`);
  } finally {
    await remote.close();
    await local.close();
  }
}

/** Copies session records both ways for every project either side knows. */
async function syncSessions(local: MemoryStore, remote: MemoryStore): Promise<number> {
  const projects = new Set<string>();
  for (const store of [local, remote]) {
    for (const entry of await store.listProjects()) projects.add(entry.project);
  }

  let moved = 0;
  for (const project of projects) {
    for (const [from, to] of [[local, remote], [remote, local]] as const) {
      for (const session of await from.recentSessions(project, 1000)) {
        if (await to.getSession(session.id)) continue;
        await to.upsertSession(session);
        moved += 1;
      }
    }
  }
  return moved;
}

/** `eachObservation` against an arbitrary store rather than the local context. */
async function eachRemoteObservation(
  store: MemoryStore,
  visit: (batch: Observation[]) => Promise<void> | void,
): Promise<void> {
  let after = 0;
  for (;;) {
    const batch = await store.list({ after, limit: BATCH });
    if (batch.length === 0) return;

    await visit(batch);

    const last = batch[batch.length - 1];
    if (!last) return;
    after = last.createdAt === after ? after + 1 : last.createdAt;
    if (batch.length < BATCH) return;
  }
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
 * Re-keys memory recorded under an old project path onto this one.
 *
 * Memory used to be keyed on the exact directory the agent was launched in, so
 * anyone who worked from `repo/frontend` accumulated a second, disjoint memory.
 * Keying on the repository root fixes that going forward but strands whatever
 * is already under the old path, and nothing about it is visible: the memory
 * simply does not appear.
 *
 * Re-inserting rather than issuing an UPDATE is deliberate. Observation ids are
 * content-derived and independent of the project, so writing the same rows with
 * a new project overwrites in place, and every derived field that depends on the
 * project — the FTS scope token above all — is recomputed on the way through.
 */
async function cmdMerge(argv: (string | undefined)[]): Promise<void> {
  const into = resolveProject(undefined);
  const confirmed = argv.includes('--yes') || argv.includes('-y');
  const given = argv.find((arg) => typeof arg === 'string' && !arg.startsWith('-'));

  const ctx = await createContext();
  try {
    if (!given) {
      await listShards(ctx, into);
      return;
    }

    // Resolved but deliberately not run through resolveProject: that maps a
    // subdirectory to the repository root, which is the very key being merged
    // *into*, so the source would resolve to the destination and match nothing.
    const from = resolve(given);
    if (from === into) {
      console.error('Source and destination are the same project.');
      process.exit(1);
    }

    let moved = 0;
    const total = await eachObservation(ctx, { project: from }, async (batch) => {
      if (!confirmed) return;
      await ctx.store.insertObservations(batch.map((obs) => ({ ...obs, project: into })));
      moved += batch.length;
    });

    if (total === 0) {
      console.error(`No memory stored under ${from}.`);
      console.error('Run `claude-db projects` to see the exact paths in this database.');
      process.exit(1);
    }

    if (!confirmed) {
      console.log(`This would move ${total} observation(s):`);
      console.log(`  from ${from}`);
      console.log(`  into ${into}`);
      console.log('\nNothing was moved. Re-run with --yes to confirm.');
      return;
    }

    // Sessions carry the recap injected at SessionStart, so they follow their
    // observations. Only summarised ones are worth moving; the rest go with
    // the cleanup below.
    for (const session of await ctx.store.recentSessions(from, 1000)) {
      await ctx.store.upsertSession({ ...session, project: into });
    }
    const swept = await ctx.store.remove({ project: from });

    console.log(`Moved ${moved} observation(s) into ${into}.`);
    if (swept > 0) console.log(`Cleaned up ${swept} leftover row(s) under the old path.`);
  } finally {
    await ctx.close();
  }
}

/** Projects in this database that sit underneath the current one. */
async function listShards(ctx: RecallContext, into: string): Promise<void> {
  const shards = (await ctx.store.listProjects()).filter(
    (entry) => entry.project !== into && entry.project.startsWith(`${into}/`),
  );

  if (shards.length === 0) {
    console.log(`No memory is stored under a subdirectory of ${into}.`);
    console.log('Nothing to merge.');
    return;
  }

  console.log(`Memory recorded under subdirectories of ${into}:\n`);
  for (const shard of shards) {
    console.log(`  ${String(shard.observations).padStart(5)}  ${shard.project}`);
  }
  console.log('\nMerge one in with:');
  console.log(`  claude-db merge ${shards[0]?.project} --yes`);
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

    const deleted = await ctx.store.remove(scoped ? { project } : {});
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
  const transcripts = transcriptsFor(project);

  if (transcripts.length === 0) {
    console.error(`No transcripts found for ${project}`);
    process.exit(1);
  }

  const ctx = await createContext();
  let total = 0;

  try {
    for (const path of transcripts) {
      const sessionId = basename(path, '.jsonl');
      // Ignore any stored cursor and the stored recap: a manual flush is asking
      // for a full re-read, so both are rebuilt rather than extended.
      resetCursor(sessionId);
      const result = await flushSession(ctx, sessionId, project, path, true);
      if (result.observations > 0) {
        console.log(`${sessionId.slice(0, 8)}  ${String(result.observations).padStart(4)} observations`);
        total += result.observations;
      }
    }
  } finally {
    await ctx.close();
  }

  console.log(`\n${total} observations from ${transcripts.length} transcript(s).`);
  const swept = sweepCursors();
  if (swept > 0) console.log(`Swept ${swept} cursor(s) for transcripts that no longer exist.`);
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
  console.log(`Guidance : ${instructionsPathFor(scope, project)}`);
  console.log(`Skill    : ${skillPathFor(scope, project)} (/cdb-scan)`);
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

    const saved = (await ctx.store.listProjects()).find((entry) => entry.project === project);
    const lastSaved = saved?.lastActive ?? 0;
    const worked = workedAt(project);
    console.log(`recorded : ${lastSaved > 0 ? ago(lastSaved) : 'never'}`);

    if (active.length === 0) {
      console.log('\nHooks are not registered, so nothing will ever be captured.');
      console.log('Run this from the project you want to track:');
      console.log('  claude-db install --project');
    } else if (hasStalled(lastSaved, worked)) {
      console.log(`\nCapture looks stalled. This project was worked in ${ago(worked.last)},`);
      console.log(
        lastSaved > 0
          ? `but the newest memory is from ${ago(lastSaved)}.`
          : 'but nothing has ever been recorded for it.',
      );
      console.log('Nothing reports this on its own: hooks swallow their errors so a');
      console.log('memory layer can never break a session. Check it end to end with:');
      console.log('  claude-db doctor --deep');
    } else if (sessions.length === 0) {
      console.log('\nInstalled, but nothing recorded yet. Memory is written as you');
      console.log('work, on every prompt, and only for turns that changed something.');
      console.log('If you installed just now, restart Claude Code first.');
    }
  } finally {
    await ctx.close();
  }
}

/** When this project's transcripts were first and last appended to. */
function workedAt(project: string): { first: number; last: number } {
  let first = Number.POSITIVE_INFINITY;
  let last = 0;
  for (const path of transcriptsFor(project)) {
    try {
      const { mtimeMs } = statSync(path);
      first = Math.min(first, mtimeMs);
      last = Math.max(last, mtimeMs);
    } catch {
      // Deleted between listing and stat; nothing to learn from it.
    }
  }
  return { first: Number.isFinite(first) ? first : 0, last };
}

/**
 * Work happened and capture didn't — the signal every silent failure leaves.
 *
 * Measured from the last save, except when there has never been one: then the
 * baseline is the *first* transcript, so an install done ten minutes ago reads
 * as new rather than broken, while a project worked in for days with an empty
 * database reads as broken, which it is.
 */
function hasStalled(lastSaved: number, worked: { first: number; last: number }): boolean {
  if (worked.last === 0) return false;
  return worked.last > (lastSaved > 0 ? lastSaved : worked.first) + STALL_MS;
}

function ago(when: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - when) / 60_000));
  const date = new Date(when).toISOString().slice(0, 10);
  if (minutes < 90) return `${minutes} minute(s) ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour(s) ago (${date})`;
  return `${Math.round(hours / 24)} day(s) ago (${date})`;
}

/** True when a settings file contains one of our hook commands. */
function isInstalled(settingsPath: string): boolean {
  return fileMentions(settingsPath, resolve(DIST_DIR, 'hooks', 'session-end.js'));
}

function fileMentions(path: string, needle: string): boolean {
  try {
    return readFileSync(path, 'utf8').includes(needle);
  } catch {
    return false;
  }
}

/**
 * Points memory at a database, but only once it answers.
 *
 * Saving first and connecting second is how this used to work, and a typo or a
 * decommissioned host left the config pointing at nothing. The command crashed,
 * and so did every hook after it — so the damage surfaced on some later prompt,
 * far from the cause, as memory quietly recording nothing at all.
 */
async function cmdUse(argv: (string | undefined)[]): Promise<void> {
  const force = argv.includes('--force');
  const uri = argv.find((arg) => typeof arg === 'string' && !arg.startsWith('-'));

  if (!uri) {
    console.error('Usage: claude-db use [--force] <connection-string>');
    process.exit(1);
  }

  let kind = '';
  let foreign: string[] = [];
  let rows = 0;
  try {
    const store = await createStore(uri);
    try {
      if (!(await store.ping())) throw new Error('connected, but it did not answer a ping');
      kind = store.kind;
      // Read before init(), which creates our two tables: after that there is
      // no way to tell an empty memory database from someone's application
      // database that we have just started writing into.
      foreign = await store.inventory();
      await store.init();
      rows = await countObservations(store);
    } finally {
      await store.close();
    }
  } catch (error) {
    console.error(`Could not reach that database: ${describe(error)}`);
    if (!force) {
      console.error('\nNothing was changed; memory still uses the previous database.');
      console.error('Re-run with --force to save it anyway.');
      process.exit(1);
    }
  }

  const config = loadConfig();
  const previous = config.database;
  config.database = uri;
  saveConfig(config);
  console.log(kind ? `Connected. Using ${kind}.` : 'Saved, unverified.');

  if (foreign.length > 0) {
    const shown = foreign.slice(0, 6).join(', ');
    console.log(`\nNote: this database already holds ${foreign.length} other table(s)/collection(s):`);
    console.log(`  ${shown}${foreign.length > 6 ? ', ...' : ''}`);
    console.log('claude-db has added its own next to them. An application database is a');
    console.log('poor place to keep memory; point it elsewhere if that was not deliberate.');
  }
  if (kind && rows === 0) await warnAboutStranding(previous, uri);
}

async function countObservations(store: { listProjects: MemoryStore['listProjects'] }): Promise<number> {
  return (await store.listProjects()).reduce((total, entry) => total + entry.observations, 0);
}

/**
 * Switching backends leaves everything already recorded behind, in silence.
 *
 * Observed twice in one day: `use` pointed at Atlas, then at Aiven, and each
 * time six hundred observations stayed in SQLite while the new backend started
 * empty. `export`/`import` has always solved it, but only for someone who
 * already knew there was something to solve.
 */
async function warnAboutStranding(previous: string, uri: string): Promise<void> {
  if (!previous || previous === uri) return;

  let stranded = 0;
  try {
    const store = await createStore(previous);
    try {
      await store.init();
      stranded = await countObservations(store);
    } finally {
      await store.close();
    }
  } catch {
    return; // the old database is gone too; nothing to strand
  }
  if (stranded === 0) return;

  // The URL is shown only to identify which database, so its credentials are
  // stripped: this is exactly the string people paste without thinking.
  console.log(`\nThe database you just left (${redact(previous)})`);
  console.log(`still holds ${stranded} observation(s), and this one is empty. Nothing moves`);
  console.log('across on its own:');
  console.log('  claude-db use <the previous url> && claude-db export --all > memory.jsonl');
  console.log('  claude-db use <this url>         && claude-db import memory.jsonl');
}

/** A driver error names the problem; these name the fix. */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOTFOUND|EAI_AGAIN/.test(message)) {
    return `${message}\n(that host does not resolve — check the name, or whether the service still exists)`;
  }
  if (/self[- ]signed certificate|unable to verify the first certificate|SELF_SIGNED_CERT/i.test(message)) {
    return (
      `${message}\n(managed Postgres signs with its own CA, which node does not trust by ` +
      `default —\n append &sslmode=no-verify to the URL, or point &sslrootcert= at the CA ` +
      `file\n the provider gives you)`
    );
  }
  return message;
}

async function cmdDoctor(argv: (string | undefined)[]): Promise<void> {
  // No embedder timeout here: doctor is where you want to wait for a first
  // model download, so that the hooks afterwards find it cached.
  const base = loadConfig();
  const ctx = await createContext({
    embeddings: { ...base.embeddings, timeoutMs: 0 },
  });
  const reachable = await ctx.store.ping();

  // Report measured capability, not configured intent. Printing "384d" for an
  // embedder that cannot actually run is worse than printing nothing.
  const embedder = await ctx.embedder();
  const vectors = await probeEmbedder(embedder);

  console.log(`version  : ${packageVersion()}`);
  console.log(`database : ${ctx.config.database}`);
  console.log(`adapter  : ${ctx.store.kind}`);
  console.log(`reachable: ${reachable ? 'yes' : 'no'}`);
  console.log(`requested: embeddings.provider = ${ctx.config.embeddings.provider}`);
  console.log(`embedder : ${embedder.id} (${embedder.dimensions}d)`);
  console.log(`vectors  : ${vectors}`);
  console.log(`search   : ${vectors.startsWith('working') ? 'hybrid (keyword + vector)' : 'keyword only'}`);

  const healthy = argv.includes('--deep') ? await deepCheck(ctx) : true;

  await ctx.close();
  process.exit(reachable && healthy ? 0 : 1);
}

/**
 * Proves capture, search and recall work *now*, instead of proving the database
 * answers a ping.
 *
 * Every failure this tool has shipped was silent — hooks swallow their errors
 * so a memory layer can never break a session — and each one left `doctor`
 * reporting a healthy database it was no longer writing to. A round trip
 * through the real adapter, embedder and index is the only thing that can tell
 * the difference.
 */
async function deepCheck(ctx: RecallContext): Promise<boolean> {
  const project = resolveProject(undefined);
  // A single opaque token: FTS tokenises on non-word characters, so hyphens
  // would split the canary into pieces other observations could match.
  const canary = `zz${randomUUID().replace(/-/g, '')}`;
  let ok = true;

  const step = (label: string, passed: boolean, detail = ''): void => {
    if (!passed) ok = false;
    console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  };

  console.log('\ndeep check (writes one observation, then deletes it)');

  let id = '';
  try {
    const written = await remember(ctx, {
      project,
      kind: 'context',
      text: `claude-db self check ${canary}`,
    });
    id = written.id;
    step('write', true, toShortId(id));
  } catch (error) {
    step('write', false, error instanceof Error ? error.message : String(error));
    return false;
  }

  try {
    const found = await ctx.search.search({ text: canary, project, limit: 5 });
    step('search', found.some((entry) => entry.id === id), `${found.length} result(s)`);

    const [full] = await ctx.search.getObservations([id]);
    step('expand', full?.body.includes(canary) === true);
  } finally {
    // In a finally block so a failed search still takes the canary back out.
    const deleted = await ctx.store.remove({ ids: [id] });
    step('cleanup', deleted === 1, `${deleted} removed`);
  }

  return ok;
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

async function cmdSearch(argv: (string | undefined)[]): Promise<void> {
  const all = argv.includes('--all');
  const tag = valueOf(argv, '--tag');
  const query = withoutFlags(argv, ['--tag']).filter((arg) => arg !== '--all').join(' ');

  if (!query.trim()) {
    console.error('Usage: claude-db search [--all] [--tag <name>] <query>');
    process.exit(1);
  }
  const ctx = await createContext();
  const results = await ctx.search.search({
    text: query,
    // Scoping is right for injection, but "where did I solve this before" is
    // inherently cross-project, and only the CLI can ask that question.
    ...(all ? {} : { project: resolveProject(undefined) }),
    ...(tag ? { tag } : {}),
    limit: 10,
  });
  // Same short-id format the MCP tools emit, so ids copied from either place
  // work in the other.
  for (const entry of results) {
    const date = new Date(entry.createdAt).toISOString().slice(0, 10);
    const where = all ? `  ${basename(entry.project)}` : '';
    console.log(
      `${toShortId(entry.id)}  ${entry.kind.padEnd(10)} ${date}${where}  ${entry.title}`,
    );
    if (entry.snippet) console.log(`              ${entry.snippet}`);
  }
  if (results.length === 0) console.log('No matching observations.');
  await ctx.close();
}

async function cmdRemember(argv: (string | undefined)[]): Promise<void> {
  const kind = valueOf(argv, '--kind');
  const key = valueOf(argv, '--key');
  const tag = valueOf(argv, '--tag');
  const text = withoutFlags(argv, ['--kind', '--key', '--tag']).join(' ').trim();

  if (!text) {
    console.error('Usage: claude-db remember [--kind <kind>] [--key <name>] [--tag <name>] <text>');
    process.exit(1);
  }

  const ctx = await createContext();
  try {
    const observation = await remember(ctx, {
      project: resolveProject(undefined),
      text,
      ...(kind ? { kind: kind as ObservationKind } : {}),
      ...(key ? { key } : {}),
      ...(tag ? { tags: [tag] } : {}),
    });
    console.log(`Remembered ${toShortId(observation.id)} [${observation.kind}] ${observation.title}`);
  } finally {
    await ctx.close();
  }
}

async function cmdForget(argv: (string | undefined)[]): Promise<void> {
  const ids = argv.filter((arg): arg is string => typeof arg === 'string' && arg.length > 0);
  if (ids.length === 0) {
    console.error('Usage: claude-db forget <id> [id...]');
    process.exit(1);
  }

  const ctx = await createContext();
  try {
    // Shown before deleting: a short id is a prefix match, and the only way to
    // be sure it means what you think is to read the titles back.
    const doomed = await ctx.store.getObservations(ids);
    for (const obs of doomed) {
      console.log(`  ${toShortId(obs.id)} [${obs.kind}] ${obs.title}`);
    }
    const deleted = await ctx.store.remove({ ids });
    console.log(deleted > 0 ? `Forgot ${deleted} observation(s).` : 'No match.');
  } finally {
    await ctx.close();
  }
}

/** Pages rather than loading everything: a shared database can be large. */
async function eachObservation(
  ctx: RecallContext,
  filter: { project?: string },
  visit: (batch: Observation[]) => Promise<void> | void,
): Promise<number> {
  let after = 0;
  let total = 0;

  for (;;) {
    const batch = await ctx.store.list({ ...filter, after, limit: BATCH });
    if (batch.length === 0) return total;

    await visit(batch);
    total += batch.length;

    const last = batch[batch.length - 1];
    if (!last) return total;
    // createdAt is not unique, so a batch that lands entirely on one timestamp
    // would loop forever. Nudging past it drops at most a co-timestamped tail.
    after = last.createdAt === after ? after + 1 : last.createdAt;
    if (batch.length < BATCH) return total;
  }
}

async function cmdExport(argv: (string | undefined)[]): Promise<void> {
  const all = argv.includes('--all');
  const ctx = await createContext();

  try {
    const count = await eachObservation(
      ctx,
      all ? {} : { project: resolveProject(undefined) },
      (batch) => {
        for (const obs of batch) process.stdout.write(`${JSON.stringify(obs)}\n`);
      },
    );
    process.stderr.write(`${count} observation(s) exported.\n`);
  } finally {
    await ctx.close();
  }
}

async function cmdImport(path: string | undefined): Promise<void> {
  if (!path) {
    console.error('Usage: claude-db import <file.jsonl>');
    process.exit(1);
  }

  const lines = readFileSync(path, 'utf8').split('\n').filter((line) => line.trim().length > 0);
  const ctx = await createContext();
  let imported = 0;

  try {
    for (let i = 0; i < lines.length; i += BATCH) {
      const batch = lines
        .slice(i, i + BATCH)
        .map((line) => JSON.parse(line) as Observation)
        .filter((obs) => typeof obs.id === 'string' && typeof obs.project === 'string');
      await ctx.store.insertObservations(batch);
      imported += batch.length;
    }
  } finally {
    await ctx.close();
  }

  // Ids are content-derived, so re-importing the same file is a no-op rather
  // than a second copy of every memory.
  console.log(`Imported ${imported} observation(s).`);
}

async function cmdPrune(argv: (string | undefined)[]): Promise<void> {
  const days = Number(valueOf(argv, '--older-than') ?? NaN);
  const kind = valueOf(argv, '--kind') as ObservationKind | undefined;
  const confirmed = argv.includes('--yes') || argv.includes('-y');
  const all = argv.includes('--all');

  if (!Number.isFinite(days) || days <= 0) {
    console.error('Usage: claude-db prune --older-than <days> [--kind <kind>] [--all] --yes');
    process.exit(1);
  }

  const before = Date.now() - days * 86_400_000;
  const filter = {
    before,
    ...(all ? {} : { project: resolveProject(undefined) }),
    ...(kind ? { kind } : {}),
  };

  const ctx = await createContext();
  try {
    if (!confirmed) {
      // Counted by paging rather than one unbounded query, and against the
      // same predicate the delete uses, so the dry run cannot disagree with it.
      let matching = 0;
      await eachObservation(ctx, all ? {} : { project: resolveProject(undefined) }, (batch) => {
        for (const obs of batch) {
          if (obs.createdAt < before && (!kind || obs.kind === kind)) matching += 1;
        }
      });
      console.log(
        `This would delete ${matching} observation(s) older than ${days} day(s)` +
          `${kind ? ` of kind ${kind}` : ''}.`,
      );
      console.log('\nNothing was deleted. Re-run with --yes to confirm.');
      return;
    }
    const deleted = await ctx.store.remove(filter);
    console.log(`Pruned ${deleted} observation(s).`);
  } finally {
    await ctx.close();
  }
}

/**
 * Re-embeds everything with the currently configured model.
 *
 * Installing @xenova/transformers changes the embedding space from 256d to
 * 384d, and `cosine` refuses to compare across widths, so without this an
 * upgrade makes existing memory *less* searchable rather than more.
 */
async function cmdReembed(): Promise<void> {
  const base = loadConfig();
  const ctx = await createContext({ embeddings: { ...base.embeddings, timeoutMs: 0 } });

  try {
    const embedder = await ctx.embedder();
    if (embedder.dimensions === 0) {
      console.error('No embedder available; nothing to do.');
      process.exit(1);
    }

    let updated = 0;
    let skipped = 0;
    const scanned = await eachObservation(ctx, {}, async (batch) => {
      const stale = batch.filter((obs) => obs.embedder !== embedder.id);
      skipped += batch.length - stale.length;
      if (stale.length === 0) return;

      await embedObservations(ctx, stale);
      await ctx.store.insertObservations(stale);
      updated += stale.length;
      process.stderr.write(`\r${updated} re-embedded...`);
    });

    process.stderr.write('\r');
    console.log(
      `Scanned ${scanned}, re-embedded ${updated} with ${embedder.id}` +
        `${skipped > 0 ? `, ${skipped} already current` : ''}.`,
    );
  } finally {
    await ctx.close();
  }
}

async function cmdStats(): Promise<void> {
  const project = resolveProject(undefined);
  const ctx = await createContext();

  try {
    const kinds = new Map<string, number>();
    const tags = new Map<string, number>();
    let embedded = 0;
    let earliest = Number.POSITIVE_INFINITY;
    let latest = 0;

    const total = await eachObservation(ctx, { project }, (batch) => {
      for (const obs of batch) {
        kinds.set(obs.kind, (kinds.get(obs.kind) ?? 0) + 1);
        for (const tag of obs.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
        if (obs.embedding && obs.embedding.length > 0) embedded += 1;
        earliest = Math.min(earliest, obs.createdAt);
        latest = Math.max(latest, obs.createdAt);
      }
    });

    if (total === 0) {
      console.log(`No memory stored for ${project}.`);
      return;
    }

    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    console.log(`project     : ${project}`);
    console.log(`observations: ${total}`);
    console.log(`range       : ${day(earliest)} to ${day(latest)}`);
    console.log(`embedded    : ${embedded} of ${total}`);
    console.log('\nby kind');
    for (const [kind, n] of [...kinds].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(5)}  ${kind}`);
    }
    if (tags.size > 0) {
      console.log('\nby area');
      for (const [tag, n] of [...tags].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
        console.log(`  ${String(n).padStart(5)}  ${tag}`);
      }
    }
  } finally {
    await ctx.close();
  }
}

/**
 * Also the entry point the SessionEnd hook spawns detached, with --quiet.
 */
async function cmdUpdate(argv: (string | undefined)[]): Promise<void> {
  const quiet = argv.includes('--quiet');
  const config = loadConfig();
  // An explicit `claude-db update` means now, whatever the config says about
  // the background behaviour.
  const mode = quiet ? config.updates : 'auto';

  const result = await checkForUpdate(mode);
  if (quiet) return;

  if (result.installed) console.log(`Updated ${result.current} -> ${result.latest}.`);
  else if (result.latest && result.latest !== result.current) {
    console.log(`${result.latest} is available (running ${result.current}): ${result.reason}`);
  } else console.log(`Up to date (${result.current}).`);
}

function valueOf(argv: (string | undefined)[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

/** Everything that is not one of the named flags or its value. */
function withoutFlags(argv: (string | undefined)[], flags: string[]): string[] {
  const dropped = new Set<number>();
  for (const flag of flags) {
    const at = argv.indexOf(flag);
    // Guarded: indexOf returns -1 for an absent flag, and dropping index 0
    // silently ate the first word of the text being remembered.
    if (at >= 0) dropped.add(at).add(at + 1);
  }
  return argv.filter(
    (arg, index): arg is string => typeof arg === 'string' && !dropped.has(index),
  );
}

function usage(): void {
  console.log(`claude-db

  install [--project]         Register hooks + MCP server with Claude Code
  uninstall [--project]       Remove them again, leaving memory intact
  status                      Is it wired up, and has it recorded anything
  doctor [--deep]             Show resolved config; --deep proves a full
                              write, search, recall and delete round trip
  use [--force] <url>         Point memory at a database, once it answers
  search [--all] <query>      Search memory, this project or every project
         [--tag <name>]       ...limited to one repo or top-level directory
  remember [--kind k] <text>  Record something outright, e.g. a house rule
           [--key <name>]     ...under a stable name, replacing any earlier one
  forget <id> [id...]         Delete specific observations by id
  projects                    List every project with memory in this database
  merge [<old-path>] [--yes]  Move memory from an old project path onto this one
  stats                       What this project's memory is made of
  flush                       Re-ingest every transcript for this project
  seed --from-git [--limit n] Fill a cold memory from this repo's history
  export [--all] > out.jsonl  Dump memory as JSONL, for backup or migration
  import <file.jsonl>         Load a dump back in (safe to repeat)
  sync <url> [--yes]          Two-way merge with another database
  update                      Install a newer compatible release now
  reembed                     Re-embed everything with the current model
  prune --older-than <days>   Delete old memory (dry run without --yes)
  reset [--project] --yes     Delete stored memory (dry run without --yes)

  --project  scope to the current repo via .claude/settings.local.json
             instead of every project on this machine

Connection strings:
  mongodb+srv://user:pass@cluster.mongodb.net/memory
  postgres://user:pass@host:5432/memory
  /path/to/memory.db                          (SQLite, default)

Or set CLAUDE_DB_URL in the environment to override config.json.`);
}
