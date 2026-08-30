import type { Observation, ObservationKind, Session } from '../../types.js';
import type { RecallContext } from '../../context.js';
import { BATCH } from '../constants.js';

const SESSION_LIMIT = 10000;
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
  let after: number | undefined;
  let afterId: string | undefined;
  let total = 0;

  for (;;) {
    const batch = await ctx.store.list({
      ...filter,
      ...(after === undefined ? {} : { after }),
      ...(afterId === undefined ? {} : { afterId }),
      limit: BATCH,
    });
    if (batch.length === 0) return total;

    await visit(batch);
    total += batch.length;

    const last = batch[batch.length - 1];
    if (!last) return total;
    after = last.createdAt;
    afterId = last.id;
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

    const projects = all
      ? [
          ...new Set([
            ...(await ctx.store.listProjects()).map((entry) => entry.project),
            ...(await ctx.store.sessionProjects()),
          ]),
        ]
      : [resolveProject(undefined)];

    let sessions = 0;
    for (const project of projects) {
      for (const session of await ctx.store.recentSessions(project, SESSION_LIMIT)) {
        process.stdout.write(`${JSON.stringify({ ...session, _type: 'session' })}\n`);
        sessions += 1;
      }
    }

    process.stderr.write(`${count} observation(s) and ${sessions} session(s) exported.\n`);
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

  let skipped = 0;
  let restored = 0;

  try {
    for (let i = 0; i < lines.length; i += BATCH) {
      const batch: Observation[] = [];
      for (const line of lines.slice(i, i + BATCH)) {
        let parsed: Observation & { _type?: string };
        try {
          parsed = JSON.parse(line) as Observation & { _type?: string };
        } catch {
          skipped += 1;
          continue;
        }
        if (parsed._type === 'session') {
          const { _type, ...session } = parsed as unknown as Session & { _type: string };
          void _type;
          if (typeof session.id === 'string' && typeof session.project === 'string') {
            await ctx.store.upsertSession(session);
            restored += 1;
          } else skipped += 1;
          continue;
        }
        if (typeof parsed.id === 'string' && typeof parsed.project === 'string') batch.push(parsed);
        else skipped += 1;
      }
      if (batch.length > 0) await ctx.store.insertObservations(batch);
      imported += batch.length;
    }
  } finally {
    await ctx.close();
  }

  console.log(
    `Imported ${imported} observation(s)` +
      `${restored > 0 ? `, ${restored} session(s)` : ''}` +
      `${skipped > 0 ? `, skipped ${skipped} unreadable line(s)` : ''}.`,
  );
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

export async function cmdReembed(argv: (string | undefined)[] = []): Promise<void> {
  const scoped = argv.includes('--project') || argv.includes('-p');
  const base = loadConfig();
  const ctx = await createContext({ embeddings: { ...base.embeddings, timeoutMs: 0 } });

  try {
    const embedder = await ctx.embedder();
    if (embedder.dimensions === 0) {
      console.error('No embedder available; nothing to do.');
      process.exit(1);
    }

    let migrated = false;
    if (!scoped && ctx.store.migrateVectorDims) {
      migrated = await ctx.store.migrateVectorDims(embedder.dimensions);
    }

    let updated = 0;
    let skipped = 0;
    const filter = scoped ? { project: resolveProject(undefined) } : {};
    const scanned = await eachObservation(ctx, filter, async (batch) => {
      const stale = batch.filter((obs) => obs.embedder !== embedder.id || !obs.embedding?.length);
      skipped += batch.length - stale.length;
      if (stale.length === 0) return;

      await embedObservations(ctx, stale);
      await ctx.store.insertObservations(stale);
      updated += stale.length;
      process.stderr.write(`\r${updated} re-embedded...`);
    });

    process.stderr.write('\r');
    if (migrated) {
      console.log(`Rebuilt vector storage at ${embedder.dimensions}d.`);
    }
    console.log(
      `Scanned ${scanned}, re-embedded ${updated} with ${embedder.id}` +
        `${skipped > 0 ? `, ${skipped} already current` : ''}.`,
    );
  } finally {
    await ctx.close();
  }
}
