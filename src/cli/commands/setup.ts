import { toShortId } from '../../util/shortid.js';
import { closeLandedWork, openWork } from '../../capture/index.js';
import type { Scope } from '../paths.js';
import { CONFIG_PATH } from '../../config/index.js';
import { DIST_DIR } from '../constants.js';
import { assertStableLocation, install, uninstall } from '../install.js';
import { instructionsPathFor, mcpPathFor, settingsPathFor, skillPathFor } from '../paths.js';
import { createContext } from '../../context.js';
import { join, resolve } from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { resolveProject } from '../../util/project.js';
import { transcriptsFor } from '../../capture/index.js';

export async function cmdInstall(scope: Scope): Promise<void> {
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

  console.log(
    `Scope    : ${scope === 'project' ? `this project only (${project})` : 'all projects on this machine'}`,
  );
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

function warnIfCommittable(project: string): void {
  const gitignore = join(project, '.gitignore');
  let ignored = false;
  try {
    ignored = readFileSync(gitignore, 'utf8')
      .split('\n')
      .some((line) => line.trim().replace(/^\//, '') === '.mcp.json');
  } catch {
    return;
  }

  if (ignored) return;

  console.log('\nNote: .mcp.json holds an absolute path to this machine.');
  console.log('It would break for anyone else if committed. To keep it local:');
  console.log("  echo '.mcp.json' >> .gitignore");
}

export function cmdUninstall(scope: Scope): void {
  const project = resolveProject(undefined);
  const path = uninstall(DIST_DIR, scope, project);
  console.log(
    path
      ? `Removed hooks and MCP server from ${path}`
      : 'Nothing to remove: no settings file found.',
  );
  console.log('Memory itself is untouched. Delete it with: rm -rf ~/.claude-memory');
}

const STALL_MS = 48 * 60 * 60 * 1000;

export async function cmdStatus(): Promise<void> {
  const project = resolveProject(undefined);
  const ctx = await createContext();
  try {
    const sessions = await ctx.store.recentSessions(project, 100);

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
        active.length > 0 ? active.map((entry) => entry.label).join(' + ') : 'NOT INSTALLED'
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

    await closeLandedWork(ctx.store, project);
    const open = await openWork(ctx.store, project);
    if (open.length > 0) {
      console.log(`\nNot committed yet (${open.length}), newest first:`);
      for (const obs of open.slice(0, 5)) {
        console.log(`  ${toShortId(obs.id)}  ${obs.title.slice(0, 68)}`);
      }
    }

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

function workedAt(project: string): { first: number; last: number } {
  let first = Number.POSITIVE_INFINITY;
  let last = 0;
  for (const path of transcriptsFor(project)) {
    try {
      const { mtimeMs } = statSync(path);
      first = Math.min(first, mtimeMs);
      last = Math.max(last, mtimeMs);
    } catch {}
  }
  return { first: Number.isFinite(first) ? first : 0, last };
}

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
