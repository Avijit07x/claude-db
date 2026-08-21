import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { RecallContext } from '../../context.js';
import { z } from 'zod';
import { KINDS } from './kinds.js';
import { renderIndex } from '../render.js';
import { resolveProject } from '../../util/project.js';

export function register(server: McpServer, ctx: RecallContext): void {
  server.tool(
    'search',
    'USE THIS BEFORE re-deriving anything this project already decided — before ' +
      'reading git history to reconstruct why code is the way it is, before saying ' +
      'you lack context, and before asking the user to re-explain a past decision ' +
      'or a failed approach. This answers WHY: decisions, dead ends, bugs and the ' +
      'reasoning behind them, which the source code cannot tell you. Returns a ' +
      'compact index (id, kind, date, title, and a line of the matching body) ' +
      'without full bodies; use the snippet to decide which ids are worth passing ' +
      'to get_observations rather than expanding on the title alone. For a code ' +
      'symbol use find_usages instead.',
    {
      query: z.string().describe('Natural language description of what you need'),
      project: z
        .string()
        .optional()
        .describe('Absolute project path; defaults to cwd. Pass "*" to search every project'),
      kind: z.enum(KINDS).optional(),
      tag: z
        .string()
        .optional()
        .describe(
          'Limit to one repository or top-level directory, e.g. "backend". Useful ' +
            'when a workspace pools several repos under one project',
        ),
      limit: z.number().int().min(1).max(50).default(10),
    },
    (args) => search(ctx, args),
  );
}

async function search(
  ctx: RecallContext,
  {
    query,
    project,
    kind,
    tag,
    limit,
  }: {
    query: string;
    project?: string | undefined;
    kind?: (typeof KINDS)[number] | undefined;
    tag?: string | undefined;
    limit: number;
  },
): Promise<CallToolResult> {
  const entries = await ctx.search.search({
    text: query,
    limit,
    ...(project === '*' ? {} : { project: resolveProject(project) }),
    ...(kind ? { kind } : {}),
    ...(tag ? { tag } : {}),
  });
  if (entries.length === 0) {
    return { content: [{ type: 'text', text: await noMatches(ctx, project) }] };
  }
  return { content: [{ type: 'text', text: renderIndex(entries) }] };
}

async function noMatches(ctx: RecallContext, project: string | undefined): Promise<string> {
  const scope = project === '*' ? undefined : resolveProject(project);
  const any = await ctx.store.list({ ...(scope ? { project: scope } : {}), limit: 1 });
  if (any.length === 0) {
    return scope
      ? `No memory recorded for ${scope} yet. Run \`claude-db flush\` to ingest this ` +
          `project's sessions, or pass project: "*" to search every project.`
      : 'No memory recorded in this database yet. Run `claude-db flush` to ingest sessions.';
  }
  return scope
    ? `No match in ${scope}, though it does have memory. Try broader wording, drop the kind ` +
        `or tag filter, or pass project: "*" to search every project.`
    : 'No match in any project. Try broader wording, or drop the kind or tag filter.';
}
