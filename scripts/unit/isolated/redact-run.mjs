import '../../lib/require-isolated.mjs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { report } from '../../lib/isolated.mjs';
import { createContext } from '../../../dist/context.js';
import { scrubDone } from '../../../dist/capture/scrub.js';
import { startBackgroundWork } from '../../../dist/hooks/background.js';

const CLI = new URL('../../../dist/cli/index.js', import.meta.url).pathname;
mkdirSync(join(homedir(), 'shop'), { recursive: true });
const project = realpathSync(join(homedir(), 'shop'));
const TOKEN = 'fakeTok9_exampleNotRealValue-0123456789abcdefghij';
const GITHUB = 'abc123def456ghi789';

const row = (title, body) => ({
  id: randomUUID(),
  sessionId: 'old-chat',
  project,
  kind: 'context',
  title,
  body,
  files: [],
  tags: [],
  createdAt: Date.now() - 3_600_000,
  status: 'done',
});
const leakedBody = row(
  'The token is saved.',
  `Asked: PLAYWRIGHT_MCP_EXTENSION_TOKEN=${TOKEN}\n\nThe token is saved.`,
);
const leakedTitle = row(`Set export GITHUB_TOKEN=${GITHUB} in CI`, 'Asked: wire CI\n\nDone.');
const clean = row(
  'Chose a websocket for the order feed',
  'Asked: polling?\n\nPolling hammered the API.',
);

let ctx = await createContext();
const database = ctx.config.database;
await ctx.store.insertObservations([leakedBody, leakedTitle, clean]);
await ctx.store.upsertSession({
  id: 'old-chat',
  project,
  startedAt: Date.now() - 3_600_000,
  summary: `Saved PLAYWRIGHT_MCP_EXTENSION_TOKEN=${TOKEN} for the browser`,
  updatedAt: Date.now() - 3_600_000,
});
await ctx.close();

const cli = (...args) =>
  spawnSync(process.execPath, ['--no-warnings', CLI, ...args], { cwd: project, encoding: 'utf8' });

const first = cli('redact');
report(
  'redact cleans every saved row and summary holding a secret',
  first.stdout.includes('Redacted 2 memory row(s) and 1 chat summary(ies)'),
  first.stdout + first.stderr,
);

ctx = await createContext();
try {
  const rows = await ctx.store.getObservations([leakedBody.id, leakedTitle.id, clean.id]);
  const text = JSON.stringify(rows);
  report('no saved row still holds the secrets', !text.includes(TOKEN) && !text.includes(GITHUB));
  report(
    'the rest of a cleaned row is kept',
    rows.find((obs) => obs.id === leakedBody.id)?.body.includes('The token is saved.'),
  );
  report(
    'a row with nothing to hide is left as it was',
    rows.find((obs) => obs.id === clean.id)?.body === clean.body,
  );
  const session = await ctx.store.getSession('old-chat');
  report(
    'a chat summary is cleaned and marked newer, so sync carries it',
    !session?.summary?.includes(TOKEN) && (session?.updatedAt ?? 0) > Date.now() - 60_000,
    session?.summary,
  );
} finally {
  await ctx.close();
}

report(
  'a cleaned secret cannot be found by search',
  cli('search', TOKEN).stdout.includes('No matching'),
);
report(
  'running it again finds nothing left to do',
  cli('redact').stdout.includes('Nothing to redact'),
);
report('a finished clean-up is remembered for this database', scrubDone(database));

const fresh = join(homedir(), 'fresh.db');
process.env.CLAUDE_DB_URL = fresh;
ctx = await createContext();
const later = row('Later chat', `Asked: DATABASE_PASSWORD=hunter2hunter2\n\nConnected.`);
await ctx.store.insertObservations([later]);
await ctx.close();
report('a database not cleaned yet is known as such', !scrubDone(fresh));

startBackgroundWork(project, fresh);
let finished = false;
for (let i = 0; i < 100 && !finished; i++) {
  await new Promise((done) => setTimeout(done, 100));
  finished = scrubDone(fresh);
}
ctx = await createContext();
try {
  const [after] = await ctx.store.getObservations([later.id]);
  report(
    'starting a chat cleans an uncleaned database once, in the background',
    finished && !after?.body.includes('hunter2hunter2'),
    after?.body,
  );
} finally {
  await ctx.close();
}
