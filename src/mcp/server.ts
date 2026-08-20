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

for (const tools of [search, memory, observations, usages]) tools.register(server, ctx);

const transport = new StdioServerTransport();
await server.connect(transport);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void ctx.close().finally(() => process.exit(0));
  });
}
