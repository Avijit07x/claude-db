#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createContext } from '../context.js';
import type { Observation, ObservationIndexEntry } from '../types.js';
import { toShortId } from '../util/shortid.js';
import { resolveProject } from '../util/project.js';
import { silenceSqliteWarning } from '../util/warnings.js';

silenceSqliteWarning();

const KINDS = [
  'decision', 'pattern', 'bugfix', 'context', 'deadend', 'preference',
] as const;

/**
 * Exposes memory as three tools that mirror the progressive disclosure layers.
 * Tool descriptions spell out the intended order, because the saving only
 * materializes if the agent filters at `search` before calling
 * `get_observations`.
 */
const ctx = await createContext();

const server = new McpServer({ name: 'claude-db', version: '0.1.0' });

server.tool(
  'search',
  'Layer 1. Search project memory and get a compact index of matches ' +
    '(id, kind, title, date) without bodies. Start here, then fetch details ' +
    'for only the ids that look relevant.',
  {
    query: z.string().describe('Natural language description of what you need'),
    project: z.string().optional().describe('Absolute project path; defaults to cwd'),
    kind: z.enum(KINDS).optional(),
    limit: z.number().int().min(1).max(50).default(10),
  },
  async ({ query, project, kind, limit }) => {
    const entries = await ctx.search.search({
      text: query,
      limit,
      project: resolveProject(project),
      ...(kind ? { kind } : {}),
    });
    return { content: [{ type: 'text', text: renderIndex(entries) }] };
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
