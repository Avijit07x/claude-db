import '../../lib/require-isolated.mjs';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { report } from '../../lib/isolated.mjs';
import { createContext } from '../../../dist/context.js';
import { embedObservations } from '../../../dist/capture/index.js';
import { toShortId } from '../../../dist/util/shortid.js';

const server = new URL('../../../dist/mcp/server.js', import.meta.url).pathname;
mkdirSync(join(homedir(), 'shop', 'src'), { recursive: true });
const project = realpathSync(join(homedir(), 'shop'));
writeFileSync(
  join(project, 'src', 'feed.ts'),
  'export function reconnectFeed() {\n  return 1;\n}\nreconnectFeed();\n',
);
const git = (...args) =>
  execFileSync('git', ['-c', 'user.email=t@e.st', '-c', 'user.name=t', ...args], {
    cwd: project,
    stdio: 'ignore',
  });
git('init', '-q');
git('add', '.');
git('commit', '-qm', 'feed');

const ctx = await createContext();
const row = (title, body, minutes) => ({
  id: randomUUID(),
  sessionId: 'earlier-chat',
  project,
  kind: 'decision',
  title,
  body,
  files: [],
  tags: [],
  createdAt: Date.now() - minutes * 60_000,
  status: 'done',
});
const before = row(
  'Measured polling cost',
  'Asked: is polling heavy?\n\nPolling every 3s cost 40% CPU.',
  30,
);
const decision = row(
  'Chose a websocket for the order feed',
  'Asked: should the order feed keep polling?\n\nPolling every 3s hammered the API, so the order feed moved to a websocket with backoff.',
  20,
);
const after = row(
  'Added websocket backoff',
  'Asked: reconnects?\n\nReconnects back off up to 30s.',
  10,
);
await embedObservations(ctx, [before, decision, after]);
await ctx.store.insertObservations([before, decision, after]);
await ctx.close();

const client = new Client({ name: 'claude-db-test', version: '1.0.0' });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: ['--no-warnings', server],
    cwd: project,
    env: { ...process.env },
  }),
);
const text = (result) => result.content.map((part) => part.text ?? '').join('\n');
const call = async (name, args) => text(await client.callTool({ name, arguments: args }));

try {
  const instructions = client.getInstructions() ?? '';
  report(
    'the server explains itself within the 2,048 character limit',
    instructions.includes('get_observations') && instructions.length <= 2048,
    `${instructions.length} chars`,
  );

  const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
  report(
    'every tool is registered',
    names.join(',') === 'find_usages,forget,get_observations,remember,search,timeline',
    names.join(','),
  );

  const found = await call('search', { query: 'why did the order feed stop polling' });
  report(
    'search finds the decision by meaning and prints its short id',
    found.includes('Chose a websocket for the order feed') &&
      found.includes(toShortId(decision.id)),
    found.slice(0, 200),
  );

  const full = await call('get_observations', { ids: [toShortId(decision.id)] });
  report(
    'get_observations returns the full reasoning',
    full.includes('hammered the API'),
    full.slice(0, 200),
  );

  const missing = await call('get_observations', { ids: ['00000000-0000'] });
  report('an unknown id is answered, not thrown', missing.length > 0, missing.slice(0, 120));

  const around = await call('timeline', { observation_id: toShortId(decision.id) });
  report(
    'timeline shows what came before and after',
    around.includes('Measured polling cost') && around.includes('Added websocket backoff'),
    around.slice(0, 200),
  );

  const saved = await call('remember', { text: 'Always use pnpm in this repo, never npm' });
  const rule = await call('search', { query: 'which package manager to use pnpm' });
  report(
    'a remembered rule can be found again',
    rule.includes('Always use pnpm'),
    rule.slice(0, 160),
  );

  const ruleId = /([0-9a-f]{8}-[0-9a-f]{4})/.exec(saved)?.[1];
  await call('forget', { ids: [ruleId] });
  const gone = await call('search', { query: 'which package manager to use pnpm' });
  report(
    'a forgotten rule is gone',
    Boolean(ruleId) && !gone.includes('Always use pnpm'),
    gone.slice(0, 160),
  );

  const everywhere = await call('search', { query: 'order feed websocket', project: '*' });
  report('search can look across every project', everywhere.includes('Chose a websocket'));

  const usages = await call('find_usages', { symbol: 'reconnectFeed' });
  report(
    'find_usages finds a symbol in the repository without a scan',
    usages.includes('src/feed.ts'),
    usages.slice(0, 200),
  );
} finally {
  await client.close();
}
