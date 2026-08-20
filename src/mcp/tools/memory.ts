import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RecallContext } from '../../context.js';
import { z } from 'zod';
import { KINDS } from './kinds.js';
import { remember } from '../../capture/index.js';
import { toShortId } from '../../util/shortid.js';
import { resolveProject } from '../../util/project.js';

export function register(server: McpServer, ctx: RecallContext): void {
  server.tool(
    'remember',
    'Record something the user stated outright that no transcript would capture: ' +
      'a standing rule, preference or constraint ("always use pnpm here"). Use this ' +
      'when the user says to remember something, not for work you just did — that ' +
      'is captured automatically.',
    {
      text: z.string().describe('What to remember, in full. First line becomes the title'),
      kind: z.enum(KINDS).default('preference'),
      project: z.string().optional().describe('Absolute project path; defaults to cwd'),
      key: z
        .string()
        .optional()
        .describe(
          'Stable name for a note meant to be kept current, e.g. "profile:stack". ' +
            'Remembering the same key again replaces it instead of adding a duplicate',
        ),
      tags: z.array(z.string()).max(5).optional().describe('Extra tags for filtering'),
    },
    async ({ text, kind, project, key, tags }) => {
      const observation = await remember(ctx, {
        project: resolveProject(project),
        text,
        kind,
        ...(key ? { key } : {}),
        ...(tags ? { tags } : {}),
      });
      return {
        content: [
          {
            type: 'text',
            text: `Remembered ${toShortId(observation.id)} [${observation.kind}] ${observation.title}`,
          },
        ],
      };
    },
  );

  server.tool(
    'forget',
    'Delete observations by id, for memory that is wrong or obsolete. Ids come ' +
      'from search. This cannot be undone, so confirm with the user first.',
    { ids: z.array(z.string()).min(1).max(25) },
    async ({ ids }) => {
      const deleted = await ctx.store.remove({ ids });
      return {
        content: [{ type: 'text', text: `Forgot ${deleted} observation(s).` }],
      };
    },
  );
}
