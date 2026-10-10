#!/usr/bin/env node
import { createContext } from '../context.js';
import type { RecallContext } from '../context.js';
import { addText, answerQuery, formatGraph, formatText } from '../graph/index.js';
import type { GraphAnswer } from '../graph/query/lookup.js';
import { staleFiles } from '../graph/query/stale.js';
import type { MemoryStore } from '../store/adapter.js';
import { repoRootFor } from '../usages/index.js';
import { DECLARED, isSymbol, isWord, symbolsGreppedIn } from './grep-symbols.js';
import { refreshGraphInBackground } from './graph-refresh.js';
import { readPayload, runHook } from './payload.js';
import { resolveProject } from '../util/project.js';
import { silenceSqliteWarning } from '../util/warnings.js';

silenceSqliteWarning();

const MAX_SYMBOLS = 2;
const MAX_LINES = 14;
const TEXT_LINES = 6;
const EDGE_LIMIT = 20;

function requested(payload: {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}): string[] {
  const input = payload.tool_input ?? {};
  if (payload.tool_name === 'Grep') {
    const pattern = typeof input['pattern'] === 'string' ? input['pattern'] : '';
    return isSymbol(pattern) || isWord(pattern) ? [pattern] : [];
  }
  if (payload.tool_name === 'Bash') {
    return symbolsGreppedIn(typeof input['command'] === 'string' ? input['command'] : '');
  }
  return [];
}

function trim(answer: string): string {
  const lines = answer.split('\n');
  if (lines.length <= MAX_LINES) return answer;
  return [...lines.slice(0, MAX_LINES), `  ... more via find_usages`].join('\n');
}

const answers = (answer: GraphAnswer, symbol: string): boolean =>
  !answer.empty && (isSymbol(symbol) || answer.definitions.some((d) => DECLARED.has(d.kind)));

function block(answer: GraphAnswer, root: string): string {
  const graph = trim(formatGraph(answer, root, { text: false }));
  return [graph, ...formatText(answer.text, TEXT_LINES)].join('\n');
}

const staleNote = (count: number): string =>
  `(${count} file(s) changed since the last scan and are being re-read in the background, ` +
  'so lines in them may have moved. The text matches are live.)';

async function freshnessNote(store: MemoryStore, project: string): Promise<string | null> {
  try {
    const root = repoRootFor(project);
    const stale = staleFiles(root, await store.scannedFiles(project));
    if (stale.length === 0) return null;
    refreshGraphInBackground(project, root);
    return staleNote(stale.length);
  } catch {
    return null;
  }
}

interface Answered {
  named: string[];
  blocks: string[];
}

async function answerSymbols(
  ctx: RecallContext,
  project: string,
  symbols: string[],
): Promise<Answered> {
  const answered: Answered = { named: [], blocks: [] };
  for (const symbol of symbols) {
    const answer = await answerQuery({
      store: ctx.store,
      root: project,
      project,
      query: { mode: 'usages', symbol, limit: EDGE_LIMIT, suggest: false },
      refresh: false,
      text: false,
    });
    if (!answers(answer, symbol)) continue;
    addText(answer, project);
    answered.named.push(symbol);
    answered.blocks.push(block(answer, project));
  }
  if (answered.blocks.length > 0) {
    const note = await freshnessNote(ctx.store, project);
    if (note) answered.blocks.push(note);
  }
  return answered;
}

await runHook(async () => {
  const mode = process.env['CLAUDE_DB_USAGES_HOOK'] ?? 'deny';
  if (mode === 'off') return;

  const payload = await readPayload();
  const symbols = requested(payload).slice(0, MAX_SYMBOLS);
  if (symbols.length === 0) return;

  const project = resolveProject(payload.cwd);
  const ctx = await createContext();
  let answered: Answered;
  try {
    answered = await answerSymbols(ctx, project, symbols);
  } finally {
    await ctx.close();
  }
  const { named, blocks } = answered;
  if (blocks.length === 0) return;

  const names = named.map((s) => `\`${s}\``).join(', ');
  if (mode === 'directive') {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext:
            `You are grepping the declared symbol(s) ${names}. Use the \`find_usages\` MCP ` +
            `tool for symbol lookups — grep cannot tell a call from an import or show the ` +
            `blast radius. The graph's answer for this search is below; read it instead of ` +
            `the grep output, and call find_usages directly next time:\n\n${blocks.join('\n\n')}`,
        },
      }),
    );
    return;
  }

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `Blocked: ${names} names a declared symbol — use the \`find_usages\` MCP tool ` +
          `for symbol lookups, not grep. Its answer for this search is already below, so ` +
          `nothing needs re-running:\n\n${blocks.join('\n\n')}`,
      },
    }),
  );
});
