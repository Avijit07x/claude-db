#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { remember } from '../capture/index.js';
import { createContext } from '../context.js';
import { toShortId } from '../util/shortid.js';
import { renderFull, renderIndex } from './render.js';
import { resolveProject } from '../util/project.js';
import { findUsages, formatUsages } from '../usages/index.js';
import { silenceSqliteWarning } from '../util/warnings.js';

silenceSqliteWarning();

const KINDS = [
  'decision', 'pattern', 'bugfix', 'context', 'deadend', 'preference',
] as const;

function packageVersion(): string {
  try {
    const path = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    return (JSON.parse(readFileSync(path, 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Three read tools mirroring the progressive disclosure layers, plus two that
 * write. Tool descriptions spell out the intended order, because the saving
 * only materializes if the agent filters at `search` before calling
 * `get_observations`.
 *
 * `remember` exists because capture is inferred from transcripts, and a rule
 * is not an event: "we always use pnpm here" produces no edit and no command,
 * so the one thing most worth keeping is the one thing never recorded.
 */
const ctx = await createContext();

const server = new McpServer({ name: 'claude-db', version: packageVersion() });

server.tool(
  'search',
  'Layer 1. Search project memory and get a compact index of matches ' +
    '(id, kind, date, title, and a line of the matching body) without full ' +
    'bodies. Start here, and use the snippet to decide which ids are worth ' +
    'passing to get_observations rather than expanding on the title alone.',
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
  async ({ query, project, kind, tag, limit }) => {
    const entries = await ctx.search.search({
      text: query,
      limit,
      ...(project === '*' ? {} : { project: resolveProject(project) }),
      ...(kind ? { kind } : {}),
      ...(tag ? { tag } : {}),
    });
    return { content: [{ type: 'text', text: renderIndex(entries) }] };
  },
);

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

server.tool(
  'timeline',
  'Layer 2. Show what happened immediately before and after a given ' +
    'observation, to understand the context a decision was made in.',
  {
    observation_id: z.string(),
    before: z.number().int().min(0).max(20).default(5),
    after: z.number().int().min(0).max(20).default(5),
  },
  async ({ observation_id, before, after }) => {
    const entries = await ctx.search.timeline({ observationId: observation_id, before, after });
    return { content: [{ type: 'text', text: renderIndex(entries) }] };
  },
);

server.tool(
  'get_observations',
  'Layer 3. Fetch full bodies for specific observation ids, using the short ' +
    'ids returned by search. Always batch every id you need into one call ' +
    'rather than calling repeatedly.',
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
  async ({ ids, chars }) => {
    const observations = await ctx.search.getObservations(ids);
    return {
      content: [
        { type: 'text', text: observations.map((obs) => renderFull(obs, chars)).join('\n\n---\n\n') },
      ],
    };
  },
);

server.tool(
  'find_usages',
  'Find real usages of a symbol or component name via `git grep` — a live read ' +
    'of the current source, not a stored index, so it is never stale. Returns ' +
    'file:line and the matching line, with a best-effort [definition?] marker on ' +
    'lines that look like a declaration. Use this before editing or removing a ' +
    'shared or exported name, or to answer "what uses this" (structure). Use ' +
    '`search` instead for "why is this the way it is" (history).',
  {
    symbol: z.string().min(1).max(200).describe('Exact name to search for, e.g. "useAuth" or "CartButton"'),
    path: z
      .string()
      .optional()
      .describe(
        'Directory inside the repo to search from; defaults to cwd. Must be inside ' +
          'a git working tree. Different from the memory tools’ project param, which ' +
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
  async ({ symbol, path, regex, context, limit }) => {
    const result = findUsages({ symbol, regex, context, limit, ...(path ? { path } : {}) });
    return { content: [{ type: 'text', text: formatUsages(result) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void ctx.close().finally(() => process.exit(0));
  });
}
