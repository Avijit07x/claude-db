import { CONFIG_DIR, loadConfig } from '../../config/index.js';
import { basename, join } from 'node:path';
import { checkForUpdate } from '../../update.js';
import { createContext } from '../../context.js';
import { flushSession, resetCursor, sweepCursors, transcriptsFor } from '../../capture/index.js';
import { resolveProject } from '../../util/project.js';
import { rmSync } from 'node:fs';

export async function cmdReset(argv: (string | undefined)[]): Promise<void> {
  const scoped = argv.includes('--project') || argv.includes('-p');
  const confirmed = argv.includes('--yes') || argv.includes('-y');
  const project = resolveProject(undefined);

  const ctx = await createContext();
  try {
    const target = scoped ? project : ctx.config.database;

    if (!confirmed) {
      console.log(`This would delete ${scoped ? "this project's" : 'ALL'} memory from:`);
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

function clearLocalState(): void {
  rmSync(join(CONFIG_DIR, 'cursors'), { recursive: true, force: true });
}

export async function cmdFlush(): Promise<void> {
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
      resetCursor(sessionId);
      const result = await flushSession(ctx, sessionId, project, path, true);
      if (result.observations > 0) {
        console.log(
          `${sessionId.slice(0, 8)}  ${String(result.observations).padStart(4)} observations`,
        );
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

export async function cmdUpdate(argv: (string | undefined)[]): Promise<void> {
  const quiet = argv.includes('--quiet');
  const config = loadConfig();
  const mode = quiet ? config.updates : 'auto';

  const result = await checkForUpdate(mode);
  if (quiet) return;

  if (result.installed) console.log(`Updated ${result.current} -> ${result.latest}.`);
  else if (result.latest && result.latest !== result.current) {
    console.log(`${result.latest} is available (running ${result.current}): ${result.reason}`);
  } else console.log(`Up to date (${result.current}).`);
}
