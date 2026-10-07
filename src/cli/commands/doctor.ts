import type { RecallContext } from '../../context.js';
import { createContext } from '../../context.js';
import { loadConfig } from '../../config/index.js';
import { packageVersion } from '../../update.js';
import { randomUUID } from 'node:crypto';
import { redact, remember } from '../../capture/index.js';
import { resolveProject } from '../../util/project.js';
import { ourHookFile } from '../install.js';
import { settingsPathFor } from '../paths.js';
import { existsSync, readFileSync } from 'node:fs';
import { toShortId } from '../../util/shortid.js';
import type { ClaudeLocation } from '../../util/claude-binary.js';
import { resolveClaude } from '../../util/claude-binary.js';
import { runHeadlessResult } from '../../util/claude-cli.js';
import { describeSkills } from '../skills.js';

const HAIKU_PROBE_PROMPT = 'Reply with the single word: ok';
const HAIKU_PROBE_TIMEOUT_MS = 60_000;
const REPLY_PREVIEW_CHARS = 40;

export async function cmdDoctor(argv: (string | undefined)[]): Promise<void> {
  const base = loadConfig();
  const ctx = await createContext({
    embeddings: { ...base.embeddings, timeoutMs: 0 },
  });
  const reachable = await ctx.store.ping();

  const embedder = await ctx.embedder();
  const vectors = await probeEmbedder(embedder);

  console.log(`version  : ${packageVersion()}`);
  console.log(`database : ${redact(ctx.config.database)}`);
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
  const project = resolveProject(undefined);
  checkWiring(project);
  console.log(describeSkills(project));

  const claude = resolveClaude();
  console.log(describeClaude(claude));

  const deepOk = argv.includes('--deep') ? await runDeepChecks(ctx, claude) : true;

  await ctx.close();
  process.exit(reachable && deepOk ? 0 : 1);
}

async function runDeepChecks(ctx: RecallContext, claude: ClaudeLocation | null): Promise<boolean> {
  const storeOk = await deepCheck(ctx);
  const haikuOk = await haikuCheck(ctx, claude);
  return storeOk && haikuOk;
}

export function describeClaude(location: ClaudeLocation | null): string {
  if (location) return `claude   : ${location.path} (from ${location.source})`;
  return [
    'claude   : NOT FOUND, so facts and picks cannot run',
    '           fix: put claude on PATH, or set CLAUDE_CODE_EXECPATH to its full path',
  ].join('\n');
}

async function haikuCheck(ctx: RecallContext, claude: ClaudeLocation | null): Promise<boolean> {
  const model = ctx.config.distill.model;
  console.log(`\nhaiku check (one small ${model} call, not counted against the daily limits)`);
  if (!claude) {
    console.log('  FAIL call — claude was not found');
    return false;
  }
  const result = await runHeadlessResult(HAIKU_PROBE_PROMPT, model, HAIKU_PROBE_TIMEOUT_MS);
  if (!result.ok) {
    console.log(`  FAIL call — ${result.reason}`);
    return false;
  }
  const reply = result.stdout.trim().slice(0, REPLY_PREVIEW_CHARS);
  console.log(`  ok   call — ${reply || 'empty reply'}`);
  return true;
}

function checkWiring(project: string): void {
  const problems: string[] = [];
  for (const scope of ['project', 'global'] as const) {
    const path = settingsPathFor(scope, project);
    let settings: { hooks?: Record<string, { hooks: { command: string }[] }[]> };
    try {
      settings = JSON.parse(readFileSync(path, 'utf8')) as typeof settings;
    } catch {
      continue;
    }
    for (const [event, entries] of Object.entries(settings.hooks ?? {})) {
      const ours = entries
        .flatMap((entry) => entry.hooks.map((hook) => hook.command))
        .filter((command) => ourHookFile(command) !== null);
      const counts = new Map<string, number>();
      for (const command of ours) {
        const file = ourHookFile(command) ?? '';
        counts.set(file, (counts.get(file) ?? 0) + 1);
      }
      for (const [file, count] of counts) {
        if (count > 1) problems.push(`${event} ${file} registered ${count}x in ${path}`);
      }
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
