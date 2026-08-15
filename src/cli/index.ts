#!/usr/bin/env node
import { readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  embedObservations,
  flushSession,
  remember,
  resetCursor,
  transcriptsFor,
} from '../capture/index.js';
import { createContext } from '../context.js';
import type { RecallContext } from '../context.js';
import type { Observation, ObservationKind } from '../types.js';
import { CONFIG_DIR, CONFIG_PATH, loadConfig, saveConfig } from '../config/index.js';
import {
  assertStableLocation,
  install,
  instructionsPathFor,
  mcpPathFor,
  settingsPathFor,
  uninstall,
} from './install.js';
import type { Scope } from './install.js';
import { resolveProject } from '../util/project.js';
import { silenceSqliteWarning } from '../util/warnings.js';
import { toShortId } from '../util/shortid.js';

silenceSqliteWarning();

const DIST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Declared above the command switch below, which runs before the rest of this
// module's bindings initialise.
const BATCH = 500;

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
      // Ignore any stored cursor: a manual flush is asking for a full re-read.
      resetCursor(sessionId);
      const result = await flushSession(ctx, sessionId, project, path);
      if (result.observations > 0) {
        console.log(`${sessionId.slice(0, 8)}  ${String(result.observations).padStart(4)} observations`);
        total += result.observations;
      }
    }
  } finally {
    await ctx.close();
  }

  console.log(`\n${total} observations from ${transcripts.length} transcript(s).`);
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
      console.log('\nInstalled, but nothing recorded yet. Memory is written as you');
      console.log('work, on every prompt, and only for turns that changed something.');
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

async function cmdSearch(argv: (string | undefined)[]): Promise<void> {
  const all = argv.includes('--all');
  const query = argv.filter((arg) => arg !== '--all').join(' ');

  if (!query.trim()) {
    console.error('Usage: claude-db search [--all] <query>');
    process.exit(1);
  }
  const ctx = await createContext();
  const results = await ctx.search.search({
    text: query,
    // Scoping is right for injection, but "where did I solve this before" is
    // inherently cross-project, and only the CLI can ask that question.
    ...(all ? {} : { project: resolveProject(undefined) }),
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
  }
  if (results.length === 0) console.log('No matching observations.');
  await ctx.close();
}

async function cmdRemember(argv: (string | undefined)[]): Promise<void> {
  const kindFlag = argv.indexOf('--kind');
  const kind = kindFlag >= 0 ? argv[kindFlag + 1] : undefined;
  const text = (
    kindFlag >= 0
      ? argv.filter((_, index) => index !== kindFlag && index !== kindFlag + 1)
      : argv
  )
    .join(' ')
    .trim();

  if (!text) {
    console.error('Usage: claude-db remember [--kind <kind>] <text>');
    process.exit(1);
  }

  const ctx = await createContext();
  try {
    const observation = await remember(ctx, {
      project: resolveProject(undefined),
      text,
      ...(kind ? { kind: kind as ObservationKind } : {}),
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

function valueOf(argv: (string | undefined)[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function usage(): void {
  console.log(`claude-db

  install [--project]         Register hooks + MCP server with Claude Code
  uninstall [--project]       Remove them again, leaving memory intact
  status                      Is it wired up, and has it recorded anything
  doctor                      Show resolved config and test connectivity
  use <connection-string>     Point memory at any database and verify it
  search [--all] <query>      Search memory, this project or every project
  remember [--kind k] <text>  Record something outright, e.g. a house rule
  forget <id> [id...]         Delete specific observations by id
  projects                    List every project with memory in this database
  merge [<old-path>] [--yes]  Move memory from an old project path onto this one
  stats                       What this project's memory is made of
  flush                       Re-ingest every transcript for this project
  export [--all] > out.jsonl  Dump memory as JSONL, for backup or migration
  import <file.jsonl>         Load a dump back in (safe to repeat)
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
