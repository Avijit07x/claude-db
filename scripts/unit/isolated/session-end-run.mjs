import '../../lib/require-isolated.mjs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { report } from '../../lib/isolated.mjs';
import { createContext } from '../../../dist/context.js';
import { startPick } from '../../../dist/pick/pending.js';

const hook = new URL('../../../dist/hooks/session-end.js', import.meta.url).pathname;
const memoryDir = join(homedir(), '.claude-memory');
mkdirSync(memoryDir, { recursive: true });
writeFileSync(
  join(memoryDir, 'config.json'),
  JSON.stringify({ distill: { enabled: false }, updates: 'off' }),
);
mkdirSync(join(homedir(), 'shop'), { recursive: true });
const project = realpathSync(join(homedir(), 'shop'));

const sessionId = randomUUID();
const transcript = join(homedir(), `${sessionId}.jsonl`);
const at = new Date(Date.now() - 60_000).toISOString();
writeFileSync(
  transcript,
  [
    {
      type: 'user',
      timestamp: at,
      message: { content: 'make the order feed reconnect with backoff' },
    },
    {
      type: 'assistant',
      timestamp: at,
      message: {
        content: [
          {
            type: 'text',
            text: 'The order feed now reconnects with exponential backoff, capped at 30s.',
          },
          {
            type: 'tool_use',
            id: 't1',
            name: 'Edit',
            input: { file_path: join(project, 'feed.ts') },
          },
        ],
      },
    },
  ]
    .map((entry) => JSON.stringify(entry))
    .join('\n') + '\n',
);

const job = { project, prompt: 'p', previousReply: '', ids: [], fallback: null };
startPick(sessionId, job);
const env = { ...process.env };
delete env.CLAUDE_CODE_ENTRYPOINT;
delete env.CLAUDE_DB_CAPTURE;
env.CLAUDE_CODE_EXECPATH = process.execPath;
const run = spawnSync(process.execPath, ['--no-warnings', hook], {
  input: JSON.stringify({
    session_id: sessionId,
    cwd: project,
    transcript_path: transcript,
    hook_event_name: 'SessionEnd',
  }),
  env,
  encoding: 'utf8',
});
report(
  'the hook exits cleanly and prints nothing',
  run.status === 0 && run.stdout === '',
  run.stderr,
);

report(
  'a hook run remembers where Claude Code lives, for commands run outside it',
  existsSync(join(memoryDir, 'claude-binary')) &&
    readFileSync(join(memoryDir, 'claude-binary'), 'utf8').trim() === process.execPath,
);

const ctx = await createContext();
try {
  const rows = await ctx.store.list({ project, sessionId, limit: 10 });
  report(
    'the last turn of the chat is saved when it ends',
    rows.some((obs) => obs.body.includes('exponential backoff')),
    String(rows.length),
  );
  const session = await ctx.store.getSession(sessionId);
  report(
    'the chat is marked as ended',
    typeof session?.endedAt === 'number' && session.endedAt > 0,
  );
} finally {
  await ctx.close();
}
report(
  'a pick still waiting for this chat is cleared',
  !existsSync(join(memoryDir, 'pick', 'pending', `${sessionId}.json`)),
);
report(
  'the read position for this chat is cleared',
  !existsSync(join(memoryDir, 'cursors', `${sessionId}.offset`)),
);
