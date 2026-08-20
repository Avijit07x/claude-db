#!/usr/bin/env node
import { createContext } from '../context.js';
import { formatGraph, queryGraph } from '../graph/index.js';
import { isSymbol, symbolsGreppedIn } from './grep-symbols.js';
import { readPayload, runHook } from './payload.js';
import { resolveProject } from '../util/project.js';
import { silenceSqliteWarning } from '../util/warnings.js';

silenceSqliteWarning();

const MAX_SYMBOLS = 2;
const MAX_LINES = 14;

function requested(payload: {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}): string[] {
  const input = payload.tool_input ?? {};
  if (payload.tool_name === 'Grep') {
    const pattern = typeof input['pattern'] === 'string' ? input['pattern'] : '';
    return isSymbol(pattern) ? [pattern] : [];
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

await runHook(async () => {
  if (process.env['CLAUDE_DB_USAGES_HOOK'] === 'off') return;

  const payload = await readPayload();
  const symbols = requested(payload).slice(0, MAX_SYMBOLS);
  if (symbols.length === 0) return;

  const project = resolveProject(payload.cwd);
  const ctx = await createContext();
  const blocks: string[] = [];
  try {
    for (const symbol of symbols) {
      const answer = await queryGraph(ctx.store, project, { mode: 'usages', symbol, limit: 20 });
      if (answer.empty) continue;
      blocks.push(trim(formatGraph(answer, project)));
    }
  } finally {
    await ctx.close();
  }
  if (blocks.length === 0) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext:
          `Code graph, for the symbol(s) this search names — the grep below still runs, ` +
          `this is the structure it cannot show:\n\n${blocks.join('\n\n')}`,
      },
    }),
  );
});
