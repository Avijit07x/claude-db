import type { Observation, ObservationKind } from '../../types.js';
import type { RecallContext } from '../../context.js';
import { BATCH } from '../constants.js';
import { createContext } from '../../context.js';
import { embedObservations } from '../../capture/index.js';
import { loadConfig } from '../../config/index.js';
import { readFileSync } from 'node:fs';
import { resolveProject } from '../../util/project.js';
import { valueOf } from '../args.js';

export async function eachObservation(
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
    after = last.createdAt === after ? after + 1 : last.createdAt;
    if (batch.length < BATCH) return total;
  }
}

export async function cmdExport(argv: (string | undefined)[]): Promise<void> {
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

export async function cmdImport(path: string | undefined): Promise<void> {
  if (!path) {
    console.error('Usage: claude-db import <file.jsonl>');
    process.exit(1);
  }

  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0);
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

  console.log(`Imported ${imported} observation(s).`);
}

export async function cmdPrune(argv: (string | undefined)[]): Promise<void> {
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

export async function cmdReembed(): Promise<void> {
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
