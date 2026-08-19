import type { RecallContext } from '../../context.js';
import { createContext } from '../../context.js';
import { eachObservation } from '../commands/transfer.js';
import { resolve } from 'node:path';
import { resolveProject } from '../../util/project.js';

export async function cmdStats(): Promise<void> {
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

export async function cmdProjects(): Promise<void> {
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
      console.log(`${marker} ${String(entry.observations).padStart(5)}  ${date}  ${entry.project}`);
    }
    console.log('\n* is the project you are in now. Searches only ever see one row.');
  } finally {
    await ctx.close();
  }
}

export async function cmdMerge(argv: (string | undefined)[]): Promise<void> {
  const into = resolveProject(undefined);
  const confirmed = argv.includes('--yes') || argv.includes('-y');
  const given = argv.find((arg) => typeof arg === 'string' && !arg.startsWith('-'));

  const ctx = await createContext();
  try {
    if (!given) {
      await listShards(ctx, into);
      return;
    }

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
