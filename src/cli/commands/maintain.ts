import { CONFIG_DIR, loadConfig } from '../../config/index.js';
import { join } from 'node:path';
import { checkForUpdate } from '../../update.js';
import { createContext } from '../../context.js';
import {
  finishReingest,
  finishScrub,
  redact,
  reingestProject,
  releaseReingest,
  releaseScrub,
  rememberedTranscripts,
  scrubSecrets,
  sweepCursors,
  transcriptsFor,
} from '../../capture/index.js';
import type { ProjectReingest } from '../../capture/index.js';
import { resolveProject } from '../../util/project.js';
import { rmSync } from 'node:fs';

export async function cmdReset(argv: (string | undefined)[]): Promise<void> {
  const scoped = argv.includes('--project') || argv.includes('-p');
  const confirmed = argv.includes('--yes') || argv.includes('-y');
  const project = resolveProject(undefined);

  const ctx = await createContext();
  try {
    const target = scoped ? project : redact(ctx.config.database);

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

export async function cmdFlush(argv: (string | undefined)[]): Promise<void> {
  const project = resolveProject(undefined);
  const repair = argv.includes('--repair');
  const transcripts = transcriptsFor(project);

  if (transcripts.length === 0) {
    finishReingest(project);
    console.error(`No transcripts found for ${project}`);
    process.exit(1);
  }

  let total: ProjectReingest;
  try {
    total = await reingest(project, transcripts, repair);
  } catch (error) {
    releaseReingest(project);
    throw error;
  }
  finishReingest(project);

  console.log(`\n${total.saved} observations from ${total.transcripts} transcript(s).`);
  if (total.replaced > 0) {
    console.log(
      `${total.replaced} older observation(s) saved under the previous capture rules were ` +
        'marked replaced. They stay in the database but no longer appear in search.',
    );
  }
  const swept = sweepCursors();
  if (swept > 0) console.log(`Swept ${swept} cursor(s) for transcripts that no longer exist.`);
}

async function reingest(
  project: string,
  transcripts: string[],
  repair: boolean,
): Promise<ProjectReingest> {
  const ctx = await createContext();
  try {
    const chosen = repair ? await rememberedTranscripts(ctx, project, transcripts) : transcripts;
    return await reingestProject(ctx, project, chosen, (result) => {
      if (result.saved === 0 && result.replaced === 0) return;
      const replaced = result.replaced > 0 ? `, ${result.replaced} replaced` : '';
      console.log(
        `${result.sessionId.slice(0, 8)}  ${String(result.saved).padStart(4)} observations${replaced}`,
      );
    });
  } finally {
    await ctx.close();
  }
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

export async function cmdRedact(argv: (string | undefined)[]): Promise<void> {
  const background = argv.includes('--background');
  const ctx = await createContext();
  const database = ctx.config.database;
  let result: Awaited<ReturnType<typeof scrubSecrets>>;
  try {
    result = await scrubSecrets(ctx);
  } catch (error) {
    releaseScrub(database);
    throw error;
  } finally {
    await ctx.close();
  }
  finishScrub(database);
  if (background) return;
  console.log(
    result.observations + result.sessions === 0
      ? 'Nothing to redact: no saved memory holds a secret the current rules catch.'
      : `Redacted ${result.observations} memory row(s) and ${result.sessions} chat summary(ies).`,
  );
}
