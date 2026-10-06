#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createContext } from '../context.js';
import { silenceSqliteWarning } from '../util/warnings.js';
import * as memory from './tools/memory.js';
import * as observations from './tools/observations.js';
import * as search from './tools/search.js';
import * as usages from './tools/usages.js';

silenceSqliteWarning();

const INSTRUCTIONS = [
  'Persistent memory of this project from earlier sessions: decisions, dead ends, fixes and the',
  'reasoning behind them.',
  '',
  '- A <memory> block, added with a prompt or with your first tool call after it, lists earlier',
  '  work that fits the prompt, one line each. The id at the end of a line opens the full record',
  '  with get_observations.',
  '- Call search before re-deriving why code is the way it is, before saying you lack context, and',
  '  before asking the user to re-explain a past decision or a failed approach.',
  '- Use find_usages, not grep, to look up a code symbol and what depends on it.',
  '- When the user states a standing rule or preference, record it with remember.',
].join('\n');

function packageVersion(): string {
  try {
    const path = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    return (JSON.parse(readFileSync(path, 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const ctx = await createContext();
const server = new McpServer(
  { name: 'claude-db', version: packageVersion() },
  { instructions: INSTRUCTIONS },
);

for (const tools of [search, memory, observations, usages]) tools.register(server, ctx);

const transport = new StdioServerTransport();
await server.connect(transport);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void ctx.close().finally(() => process.exit(0));
  });
}
