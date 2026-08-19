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
import { findUsages, formatUsages, repoRootFor } from '../usages/index.js';
import { formatGraph, queryGraph, refreshGraph } from '../graph/index.js';
import { silenceSqliteWarning } from '../util/warnings.js';

silenceSqliteWarning();

const KINDS = ['decision', 'pattern', 'bugfix', 'context', 'deadend', 'preference'] as const;

function packageVersion(): string {
  try {
    const path = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    return (JSON.parse(readFileSync(path, 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

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
        {
          type: 'text',
          text: observations.map((obs) => renderFull(obs, chars)).join('\n\n---\n\n'),
        },
      ],
    };
  },
);

server.tool(
  'find_usages',
  'Find real usages of a symbol, and how the code around it connects. ' +
    '`mode: "text"` (default) is a live `git grep` — never stale, works with no ' +
    'setup, and returns file:line with a best-effort [definition?] marker. The ' +
    'other modes read the code graph built by `claude-db scan`, which knows a ' +
    'call from an import from an inherit: "usages" lists what references the ' +
    'symbol with the relation on each line, "explain" adds what the symbol ' +
    'reaches, and "path" traces how two symbols connect (pass the second as ' +
    '`target`). Graph answers re-parse anything that changed before replying, ' +
    'so they cannot report a line the source has moved past. Every edge is ' +
    'tagged EXTRACTED (read literally from the syntax) or INFERRED (matched by ' +
    'name across files, with a score). Use `search` instead for "why is this ' +
    'the way it is" (history).',
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
      return { content: [{ type: 'text', text: formatUsages(result) }] };
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

const transport = new StdioServerTransport();
await server.connect(transport);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void ctx.close().finally(() => process.exit(0));
  });
}
