import type { Observation } from '../../types.js';
import { BATCH } from '../constants.js';
import { createContext } from '../../context.js';
import { embedObservations, observationsFromGit } from '../../capture/index.js';
import { resolveProject } from '../../util/project.js';
import { valueOf } from '../args.js';

export async function cmdSeed(argv: (string | undefined)[]): Promise<void> {
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
    console.error(
      `Could not read git history: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
    );
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

  console.log(`Seeded ${observations.length} observation(s) from git history.`);
  console.log(
    `Oldest: ${new Date(observations[observations.length - 1]?.createdAt ?? 0).toISOString().slice(0, 10)}`,
  );
}
