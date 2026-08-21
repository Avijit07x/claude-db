#!/usr/bin/env node
import { createContext } from '../context.js';
import { formatGraph, queryGraph } from '../graph/index.js';
import { DECLARED, isSymbol, isWord, symbolsGreppedIn } from './grep-symbols.js';
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

await runHook(async () => {
  const mode = process.env['CLAUDE_DB_USAGES_HOOK'] ?? 'deny';
  if (mode === 'off') return;

  const payload = await readPayload();
  const symbols = requested(payload).slice(0, MAX_SYMBOLS);
  if (symbols.length === 0) return;

  const project = resolveProject(payload.cwd);
  const ctx = await createContext();
  const blocks: string[] = [];
  const named: string[] = [];
  try {
    for (const symbol of symbols) {
      const answer = await queryGraph(ctx.store, project, { mode: 'usages', symbol, limit: 20 });
      if (answer.empty) continue;
      if (!isSymbol(symbol) && !answer.definitions.some((d) => DECLARED.has(d.kind))) continue;
      named.push(symbol);
      blocks.push(trim(formatGraph(answer, project)));
    }
  } finally {
    await ctx.close();
  }
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
