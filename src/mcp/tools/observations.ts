import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { RecallContext } from '../../context.js';
import { z } from 'zod';
import { renderFull, renderIndex } from '../render.js';

export function register(server: McpServer, ctx: RecallContext): void {
  server.tool(
    'timeline',
    'Given one observation id from search, show what happened immediately before ' +
      'and after it. Use it when a single result is not enough to explain itself ' +
      'and you need the session around it — what led to a decision and what came ' +
      'of it. Ids are the short ids search prints.',
    {
      observation_id: z.string(),
      before: z.number().int().min(0).max(20).default(5),
      after: z.number().int().min(0).max(20).default(5),
    },
    (args) => timeline(ctx, args),
  );

  server.tool(
    'get_observations',
    'Read the full body of observations search has already found, using the short ' +
      'ids it printed. Use it whenever a search snippet looks like it answers your ' +
      'question but is cut off — the snippet is one line, the body is the reasoning. ' +
      'Always batch every id you need into one call rather than calling repeatedly.',
    {
      ids: z.array(z.string()).min(1).max(25),
      chars: z
        .number()
        .int()
        .min(200)
        .max(20000)
        .default(2000)
        .describe(
          'Characters of each body to return. Bodies run to 4000 and this call ' +
            'takes 25 ids, so the default keeps a batch readable; raise it when a ' +
            'truncated answer says there is more',
        ),
    },
    (args) => get_observations(ctx, args),
  );
}

async function timeline(
  ctx: RecallContext,
  { observation_id, before, after }: { observation_id: string; before: number; after: number },
): Promise<CallToolResult> {
  const entries = await ctx.search.timeline({ observationId: observation_id, before, after });
  if (entries.length === 0) {
    const [found] = await ctx.search.getObservations([observation_id]);
    const text = found
      ? `No observations around ${observation_id}; it has no neighbours in that session.`
      : `No observation with id ${observation_id}. Ids come from search, and are the short ` +
        `ids it prints — run search first and pass one of those.`;
    return { content: [{ type: 'text', text }] };
  }
  return { content: [{ type: 'text', text: renderIndex(entries) }] };
}

async function get_observations(
  ctx: RecallContext,
  { ids, chars }: { ids: string[]; chars: number },
): Promise<CallToolResult> {
  const observations = await ctx.search.getObservations(ids);
  if (observations.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text:
            `No observation matched ${ids.join(', ')}. Ids come from search — run it first ` +
            `and pass the short ids it prints.`,
        },
      ],
    };
  }
  const missing = ids.filter(
    (id) => !observations.some((obs) => obs.id === id || obs.id.startsWith(id)),
  );
  const body = observations.map((obs) => renderFull(obs, chars)).join('\n\n---\n\n');
  const note = missing.length > 0 ? `\n\n(no observation matched ${missing.join(', ')})` : '';
  return { content: [{ type: 'text', text: body + note }] };
}
