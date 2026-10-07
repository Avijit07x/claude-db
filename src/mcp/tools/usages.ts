import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { RecallContext } from '../../context.js';
import { z } from 'zod';
import { findUsages as textUsages, formatUsages, repoRootFor } from '../../usages/index.js';
import {
  NO_GRAPH,
  NO_GRAPH_FOR_PATH,
  answerQuery,
  formatGraph,
  hasGraph,
  suggestFor,
} from '../../graph/index.js';
import { resolveProject } from '../../util/project.js';

export function register(server: McpServer, ctx: RecallContext): void {
  server.tool(
    'find_usages',
    'USE THIS INSTEAD OF grep/rg WHENEVER THE THING YOU ARE LOOKING UP IS A CODE ' +
      'SYMBOL — a function, class, method, type, interface, constant or any ' +
      'identifier — and ALWAYS before editing, renaming or deleting one, because ' +
      'grep cannot tell a call from an import from an inherit and will not show ' +
      'you the blast radius. Reach for grep only for what is genuinely text: ' +
      'plain prose, comments, log output, string literals, multi-pattern regex, ' +
      'or the scoping flags this tool does not expose. Modes: "usages" (default) ' +
      'lists what references the symbol, with the relation on each line, then the ' +
      'grep lines the graph could not link; "explain" adds what the symbol reaches, ' +
      '"path" traces how two symbols connect (pass the second as `target`), and ' +
      '"text" is a plain live `git grep`. Graph modes re-parse anything that ' +
      'changed before replying, and answer from text until `claude-db scan` has ' +
      'run. Every edge is tagged EXTRACTED (read literally from the syntax) or ' +
      'INFERRED (matched by name across files, with a score). A miss suggests near ' +
      'names, so a half-remembered symbol is still worth asking about. Use `search` ' +
      'instead for "why is this the way it is" (history).',
    {
      symbol: z
        .string()
        .min(1)
        .max(200)
        .describe('Exact name to search for, e.g. "useAuth" or "CartButton"'),
      mode: z
        .enum(['text', 'usages', 'explain', 'path'])
        .default('usages')
        .describe(
          'How to answer. "usages" (default) uses the code graph plus grep; "text" ' +
            'greps live only',
        ),
      target: z.string().optional().describe('The second symbol, for mode "path" only'),
      path: z
        .string()
        .optional()
        .describe(
          'A file or directory to narrow the search to; omit to search the whole ' +
            'repository (never narrows on its own — a blast-radius check that quietly ' +
            'skipped part of the repo would be worse than no check). Must be inside a ' +
            'git working tree. Different from the memory tools’ project param, which ' +
            'can point at a folder pooling several repos rather than being one itself',
        ),
      regex: z
        .boolean()
        .default(false)
        .describe('Treat symbol as an extended regular expression instead of a literal name'),
      context: z
        .number()
        .int()
        .min(0)
        .max(10)
        .default(0)
        .describe('Lines of surrounding context before/after each match'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(100)
        .describe('Cap on matching lines returned; the result says how many more exist'),
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

  const root = repoRootFor(args.path ?? process.cwd());
  const { mode, symbol, target, limit } = args;
  const answer = await answerQuery({
    store: ctx.store,
    root,
    project,
    query: { mode, symbol, ...(target ? { target } : {}), limit },
    refresh: true,
  });
  return reply(formatGraph(answer, root));
}
