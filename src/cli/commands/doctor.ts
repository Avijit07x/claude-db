import type { RecallContext } from '../../context.js';
import { createContext } from '../../context.js';
import { loadConfig } from '../../config/index.js';
import { packageVersion } from '../../update.js';
import { randomUUID } from 'node:crypto';
import { remember } from '../../capture/index.js';
import { resolveProject } from '../../util/project.js';
import { settingsPathFor } from '../paths.js';
import { existsSync, readFileSync } from 'node:fs';
import { toShortId } from '../../util/shortid.js';

export async function cmdDoctor(argv: (string | undefined)[]): Promise<void> {
  const base = loadConfig();
  const ctx = await createContext({
    embeddings: { ...base.embeddings, timeoutMs: 0 },
  });
  const reachable = await ctx.store.ping();

  const embedder = await ctx.embedder();
  const vectors = await probeEmbedder(embedder);

  console.log(`version  : ${packageVersion()}`);
  console.log(`database : ${ctx.config.database}`);
  console.log(`adapter  : ${ctx.store.kind}`);
  console.log(`reachable: ${reachable ? 'yes' : 'no'}`);
  console.log(`requested: embeddings.provider = ${ctx.config.embeddings.provider}`);
  console.log(`embedder : ${embedder.id} (${embedder.dimensions}d)`);
  console.log(`vectors  : ${vectors}`);
  console.log(
    `search   : ${vectors.startsWith('working') ? 'hybrid (keyword + vector)' : 'keyword only'}`,
  );
  if (embedder.id === 'builtin-hashing') {
    console.log('hint     : builtin embeddings are keyword-grade. For semantic vectors:');
    console.log('           npm i -g @xenova/transformers && claude-db reembed');
  }
  checkWiring(resolveProject(undefined));

  const healthy = argv.includes('--deep') ? await deepCheck(ctx) : true;

  await ctx.close();
  process.exit(reachable && healthy ? 0 : 1);
}

function checkWiring(project: string): void {
  const problems: string[] = [];
  for (const scope of ['project', 'global'] as const) {
    const path = settingsPathFor(scope, project);
    let settings: { hooks?: Record<string, { hooks: { command: string }[] }[]> };
    try {
      settings = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      continue;
    }
    for (const [event, entries] of Object.entries(settings.hooks ?? {})) {
      const ours = entries
        .flatMap((entry) => entry.hooks.map((hook) => hook.command))
        .filter((command) =>
          /[\\/]hooks[\\/](session-start|session-end|user-prompt|prefer-usages)\.js$/.test(
            command.replace(/\\/g, '/'),
          ),
        );
      if (ours.length > 1) problems.push(`${event} registered ${ours.length}x in ${path}`);
      for (const command of ours) {
        const file = command.replace(/^node\s+/, '');
        if (!existsSync(file)) problems.push(`${event} points at missing ${file}`);
      }
    }
  }
  if (problems.length === 0) {
    console.log('wiring   : ok');
    return;
  }
  for (const problem of problems) console.log(`wiring   : PROBLEM — ${problem}`);
  console.log('           fix with: claude-db install (it replaces its own entries)');
}

async function deepCheck(ctx: RecallContext): Promise<boolean> {
  const project = resolveProject(undefined);
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
    step(
      'search',
      found.some((entry) => entry.id === id),
      `${found.length} result(s)`,
    );

    const [full] = await ctx.search.getObservations([id]);
    step('expand', full?.body.includes(canary) === true);
  } finally {
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
