import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'claude-db-try-'));
const db = join(dir, 'memory.db');
const transcript = join(dir, 'session.jsonl');
const project = join(dir, 'demo-checkout-app');
const session = 'demo-session-1';

mkdirSync(project, { recursive: true });
const env = { ...process.env, CLAUDE_DB_URL: db, NODE_NO_WARNINGS: '1' };

function hook(name, payload) {
  const res = spawnSync('node', [`dist/hooks/${name}.js`], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env,
  });
  if (res.stderr?.trim()) console.log(`  \x1b[31m${res.stderr.trim().split('\n')[0]}\x1b[0m`);
  return res.stdout ?? '';
}

const step = (n, title) => console.log(`\n\x1b[1m${n}. ${title}\x1b[0m`);
const at = (min) => new Date(Date.now() - (60 - min) * 60_000).toISOString();

console.log('\x1b[1mclaude-db local trial\x1b[0m');
console.log(`throwaway db: ${db}`);

step(1, 'Claude Code records the session as JSONL');
const rows = [
  { type: 'user', timestamp: at(0), message: { content: 'the order feed keeps dropping' } },
  {
    type: 'assistant',
    timestamp: at(2),
    message: {
      content: [
        {
          type: 'text',
          text:
            'Replaced the 3s polling loop with a WebSocket subscription. Polling ' +
            'hammered the API and still lagged behind, so I moved to a push model ' +
            'with exponential backoff on reconnect and a replay flag, which means ' +
            'no order is missed during a drop.',
        },
        { type: 'tool_use', name: 'Write', input: { file_path: `${project}/src/ws/client.ts` } },
        { type: 'tool_use', name: 'Edit', input: { file_path: `${project}/src/ws/reconnect.ts` } },
        { type: 'tool_use', name: 'Bash', input: { command: 'pnpm test 2>&1 | tail -20' } },
        { type: 'tool_use', name: 'Bash', input: { command: 'grep -rn socket src/ | head -30' } },
        { type: 'tool_use', name: 'Write', input: { file_path: `${project}/.env` } },
      ],
    },
  },
  { type: 'user', timestamp: at(5), message: { content: 'ok' } },
];
writeFileSync(transcript, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`  1 prompt, 1 reply, 5 tool calls`);

step(2, 'A later prompt flushes the finished turn (no session end needed)');
hook('user-prompt', {
  session_id: session,
  cwd: project,
  transcript_path: transcript,
  prompt: 'now add pagination to the invoice table',
});
console.log('  persisted');

step(3, 'What was stored, and what was filtered out');
const { DatabaseSync } = await import('node:sqlite');
const handle = new DatabaseSync(db);
for (const row of handle.prepare('SELECT kind, title FROM observations').all()) {
  console.log(`  \x1b[36m[${row.kind}] ${row.title}\x1b[0m`);
}
console.log('  \x1b[2mdropped: the grep (exploration), and "ok" (no change)\x1b[0m');

step(4, 'A NEW session starts. This lands in context automatically');
console.log(
  '\x1b[36m' + hook('session-start', { session_id: 'demo-2', cwd: project }).trim() + '\x1b[0m',
);

step(5, 'And this is injected above a related prompt, with no tool call');
const injected = hook('user-prompt', {
  session_id: 'demo-2',
  cwd: project,
  prompt: 'why is the order feed using sockets instead of polling?',
});
console.log('\x1b[36m' + injected.trim() + '\x1b[0m');

step(6, 'Secret check: the .env write must NOT be stored');
const leaked = readFileSync(db, 'latin1').includes('.env');
console.log(
  leaked
    ? '  \x1b[31mFAIL: .env reached the database\x1b[0m'
    : '  \x1b[32mPASS: .env was excluded\x1b[0m',
);

handle.close();
rmSync(dir, { recursive: true, force: true });
console.log('\nTrial database deleted. Your Claude Code config was never touched.');
process.exit(leaked ? 1 : 0);
