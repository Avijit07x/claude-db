#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { remember } from '../capture/index.js';
import { createContext } from '../context.js';
import type { Observation, ObservationIndexEntry } from '../types.js';
import { toShortId } from '../util/shortid.js';
import { resolveProject } from '../util/project.js';
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
    '(id, kind, title, date) without bodies. Start here, then fetch details ' +
    'for only the ids that look relevant.',
  {
    query: z.string().describe('Natural language description of what you need'),
    project: z
      .string()
      .optional()
      .describe('Absolute project path; defaults to cwd. Pass "*" to search every project'),
    kind: z.enum(KINDS).optional(),
    limit: z.number().int().min(1).max(50).default(10),
  },
  async ({ query, project, kind, limit }) => {
    const entries = await ctx.search.search({
      text: query,
      limit,
      ...(project === '*' ? {} : { project: resolveProject(project) }),
      ...(kind ? { kind } : {}),
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
  },
  async ({ text, kind, project }) => {
    const observation = await remember(ctx, {
      project: resolveProject(project),
      text,
      kind,
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
  { ids: z.array(z.string()).min(1).max(25) },
  async ({ ids }) => {
    const observations = await ctx.search.getObservations(ids);
    return { content: [{ type: 'text', text: observations.map(renderFull).join('\n\n---\n\n') }] };
  },
);

/**
 * Layer 1 rendering. Every character here is multiplied by the number of
 * results and paid on every search, so the format is deliberately terse:
 * short id, kind, month-day, title. No padding, no separators, no year.
 */
export function renderIndex(entries: ObservationIndexEntry[]): string {
  if (entries.length === 0) return 'No matching observations.';
  const rows = entries.map((entry) => {
    const date = new Date(entry.createdAt).toISOString().slice(5, 10);
    return `${toShortId(entry.id)} ${entry.kind} ${date} ${entry.title}`;
  });
  return `${entries.length} result(s):\n${rows.join('\n')}`;
}

function renderFull(obs: Observation): string {
  const date = new Date(obs.createdAt).toISOString();
  return [
    `id: ${toShortId(obs.id)}`,
    `kind: ${obs.kind}`,
    `when: ${date}`,
    obs.author ? `who: ${obs.author}` : null,
    obs.files.length > 0 ? `files: ${obs.files.join(', ')}` : null,
    '',
    obs.title,
    '',
    obs.body,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

const transport = new StdioServerTransport();
await server.connect(transport);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void ctx.close().finally(() => process.exit(0));
  });
}
