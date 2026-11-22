import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { RecallContext } from '../../context.js';
import { z } from 'zod';
import { findUsages as textUsages, formatUsages } from '../../usages/index.js';
import {
  NO_GRAPH,
  NO_GRAPH_FOR_PATH,
  hasGraph,
  suggestFor,
  usagesAnswer,
} from '../../graph/index.js';
import { resolveProject } from '../../util/project.js';

export function register(server: McpServer, ctx: RecallContext): void {
  server.tool(
    'find_usages',
    'Look up a code symbol (function, class, method, type, constant): what references it ' +
      'and how. Use it before editing, renaming or deleting one; use grep for plain text, ' +
      'comments, logs and strings. Modes: "usages" (default) lists references with their ' +
      'relation, then grep lines the graph could not link; "explain" adds what the symbol ' +
      'reaches; "path" shows how `symbol` connects to `target`; "text" is a live git grep. ' +
      'Edges are EXTRACTED (from syntax) or INFERRED (matched by name, scored). A miss ' +
      'suggests near names.',
    {
      symbol: z.string().min(1).max(200).describe('Exact name, e.g. "useAuth"'),
      mode: z
        .enum(['text', 'usages', 'explain', 'path'])
        .default('usages')
        .describe('Default "usages"'),
      target: z.string().optional().describe('Second symbol, for mode "path"'),
      path: z
        .string()
        .optional()
        .describe('A file or folder inside a git working tree; omit for the whole repository'),
      regex: z
        .boolean()
        .default(false)
        .describe('Treat symbol as a regular expression (mode "text" only)'),
      context: z
        .number()
        .int()
        .min(0)
        .max(10)
        .default(0)
        .describe('Lines of context around each match (mode "text" only)'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(100)
        .describe('Cap on matching lines; the result says how many more exist'),
    },
    (args) => find_usages(ctx, args),
  );
}

interface UsagesArgs {
  symbol: string;
  mode: 'text' | 'usages' | 'explain' | 'path';
  target?: string | undefined;
  path?: string | undefined;
  regex: boolean;
  context: number;
  limit: number;
}

const reply = (text: string): CallToolResult => ({ content: [{ type: 'text', text }] });

async function textAnswer(ctx: RecallContext, args: UsagesArgs): Promise<string> {
  const { symbol, regex, context, limit, path } = args;
  const result = textUsages({ symbol, regex, context, limit, ...(path ? { path } : {}) });
  const missed =
    result.matches.length === 0
      ? await suggestFor(ctx.store, resolveProject(undefined), symbol)
      : [];
  return formatUsages(result, missed);
}

async function find_usages(ctx: RecallContext, args: UsagesArgs): Promise<CallToolResult> {
  if (args.mode === 'text') return reply(await textAnswer(ctx, args));

  const project = resolveProject(undefined);
  if (!(await hasGraph(ctx.store, project))) {
    if (args.mode === 'path') return reply(NO_GRAPH_FOR_PATH);
    return reply(`${NO_GRAPH}\n${await textAnswer(ctx, args)}`);
  }

  const { mode, symbol, target, limit, path } = args;
  return reply(
    await usagesAnswer({ store: ctx.store, project, mode, symbol, target, limit, path }),
  );
}
