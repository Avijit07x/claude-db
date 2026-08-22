import type { ObservationKind } from '../../types.js';
import { basename, join } from 'node:path';
import { createContext } from '../../context.js';
import { remember } from '../../capture/index.js';
import { resolveProject } from '../../util/project.js';
import { toShortId } from '../../util/shortid.js';
import { valueOf, withoutFlags } from '../args.js';

export async function cmdSearch(argv: (string | undefined)[]): Promise<void> {
  const all = argv.includes('--all');
  const tag = valueOf(argv, '--tag');
  const query = withoutFlags(argv, ['--tag'])
    .filter((arg) => arg !== '--all')
    .join(' ');

  if (!query.trim()) {
    console.error('Usage: claude-db search [--all] [--tag <name>] <query>');
    process.exit(1);
  }
  const ctx = await createContext();
  const results = await ctx.search.search({
    text: query,
    ...(all ? {} : { project: resolveProject(undefined) }),
    ...(tag ? { tag } : {}),
    limit: 10,
  });
  for (const entry of results) {
    const date = new Date(entry.createdAt).toISOString().slice(0, 10);
    const where = all ? `  ${basename(entry.project)}` : '';
    console.log(`${toShortId(entry.id)}  ${entry.kind.padEnd(10)} ${date}${where}  ${entry.title}`);
    if (entry.snippet) console.log(`              ${entry.snippet}`);
  }
  if (results.length === 0) console.log('No matching observations.');
  await ctx.close();
}

export async function cmdRemember(argv: (string | undefined)[]): Promise<void> {
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
    console.log(
      `Remembered ${toShortId(observation.id)} [${observation.kind}] ${observation.title}`,
    );
  } finally {
    await ctx.close();
  }
}

export async function cmdForget(argv: (string | undefined)[]): Promise<void> {
  const args = argv.filter((arg): arg is string => typeof arg === 'string' && arg.length > 0);
  const sessionAt = args.indexOf('--session');
  const ids = sessionAt >= 0 ? [] : args;
  if (sessionAt >= 0) return forgetSummary(args[sessionAt + 1]);
  if (ids.length === 0) {
    console.error('Usage: claude-db forget <id> [id...]');
    console.error('       claude-db forget --session <session-id>');
    process.exit(1);
  }

  const ctx = await createContext();
  try {
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

async function forgetSummary(sessionId: string | undefined): Promise<void> {
  if (!sessionId) {
    console.error('Usage: claude-db forget --session <session-id>');
    process.exit(1);
  }
  const ctx = await createContext();
  try {
    const cleared = await ctx.store.clearSummary(sessionId);
    console.log(
      cleared
        ? `Cleared the summary for session ${sessionId}. It will no longer be injected.`
        : `No session ${sessionId}, or it had no summary.`,
    );
  } finally {
    await ctx.close();
  }
}
