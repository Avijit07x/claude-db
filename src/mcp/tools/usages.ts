import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RecallContext } from '../../context.js';
import { z } from 'zod';
import { findUsages, formatUsages, repoRootFor } from '../../usages/index.js';
import { formatGraph, queryGraph, refreshGraph, suggestFor } from '../../graph/index.js';
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
      'or the scoping flags this tool does not expose. Modes: "usages" lists what ' +
      'references the symbol with the relation on each line, "explain" adds what ' +
      'the symbol reaches, "path" traces how two symbols connect (pass the second ' +
      'as `target`), and `mode: "text"` (default) is a live `git grep` that needs ' +
      'no scan. Graph modes read the graph built by `claude-db scan` and re-parse ' +
      'anything that changed before replying, so they cannot report a line the ' +
      'source has moved past. Every edge is tagged EXTRACTED (read literally from ' +
      'the syntax) or INFERRED (matched by name across files, with a score). A ' +
      'miss suggests near names, so a half-remembered symbol is still worth ' +
      'asking about. Use `search` instead for "why is this the way it is" (history).',
    {
      symbol: z
        .string()
        .min(1)
        .max(200)
        .describe('Exact name to search for, e.g. "useAuth" or "CartButton"'),
      mode: z
        .enum(['text', 'usages', 'explain', 'path'])
        .default('text')
        .describe(
          'How to answer. "text" greps live and needs no scan; the rest query the ' +
            'stored graph and return nothing useful until `claude-db scan` has run',
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
    async ({ symbol, mode, target, path, regex, context, limit }) => {
      if (mode === 'text') {
        const result = findUsages({ symbol, regex, context, limit, ...(path ? { path } : {}) });
        const missed =
          result.matches.length === 0
            ? await suggestFor(ctx.store, resolveProject(undefined), symbol)
            : [];
        return { content: [{ type: 'text', text: formatUsages(result, missed) }] };
      }

      const root = repoRootFor(path ?? process.cwd());
      const project = resolveProject(undefined);
      const refreshed = await refreshGraph(ctx.store, root, project);
      const answer = await queryGraph(ctx.store, project, {
        mode,
        symbol,
        ...(target ? { target } : {}),
        limit,
      });
      answer.refreshed = refreshed;
      return { content: [{ type: 'text', text: formatGraph(answer, root) }] };
    },
  );
}
