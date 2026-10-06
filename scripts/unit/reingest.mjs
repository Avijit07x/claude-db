import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../lib/check.mjs';
import { CONFIG_DIR, ConfigSchema } from '../../dist/config/index.js';
import { createContext } from '../../dist/context.js';
import {
  claimReingest,
  clearCursor,
  finishReingest,
  observationId,
  reingestDone,
  reingestSession,
  releaseReingest,
} from '../../dist/capture/index.js';
import { scopeToken } from '../../dist/util/scope.js';

const SESSION = 'unit-reingest-session';
const at = (second) => Date.UTC(2026, 9, 6, 9, 0, second);
const user = (second, content, extra = {}) => ({
  type: 'user',
  timestamp: new Date(at(second)).toISOString(),
  message: { content },
  ...extra,
});
const edit = (second, text, file) => ({
  type: 'assistant',
  timestamp: new Date(at(second)).toISOString(),
  message: {
    content: [
      { type: 'text', text },
      { type: 'tool_use', name: 'Edit', input: { file_path: file } },
    ],
  },
});

const IMAGE = '[Image: source: /tmp/claude-1000/x/images/1.png]';
const HANDBACK =
  'Another Claude session sent a message:\n<agent-message from="a1">spacing checked</agent-message>';

const oldRow = (id, project, createdAt, body, sessionId = SESSION) => ({
  id,
  sessionId,
  project,
  kind: 'pattern',
  title: body.slice(0, 40),
  body,
  files: [],
  tags: [],
  createdAt,
  status: 'done',
});

export default async function run() {
  const dir = mkdtempSync(join(tmpdir(), 'reingest-'));
  const project = join(dir, 'project');
  const path = join(dir, `${SESSION}.jsonl`);
  const rows = [
    user(1, 'the banner gap is too wide, fix it', { origin: { kind: 'human' } }),
    user(2, [{ type: 'text', text: IMAGE }], { isMeta: true }),
    edit(3, 'Removed the extra 10px of padding from the banner.', `${project}/src/banner.tsx`),
    user(4, HANDBACK, { isMeta: true, origin: { kind: 'peer' } }),
    edit(
      5,
      'The subagent confirmed the spacing, so I tightened the header too.',
      `${project}/src/header.tsx`,
    ),
  ];
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);

  const defaults = ConfigSchema.parse({});
  const ctx = await createContext({
    database: join(dir, 'memory.db'),
    embeddings: { ...defaults.embeddings, provider: 'none' },
  });

  const imageRow = observationId(SESSION, at(2), IMAGE);
  const handbackRow = observationId(SESSION, at(4), HANDBACK);
  const typedRow = observationId(SESSION, at(1), 'the banner gap is too wide, fix it');
  const liveRow = 'cccccccc-0000-0000-0000-000000000001';
  const manualRow = 'cccccccc-0000-0000-0000-000000000002';
  const otherRow = 'cccccccc-0000-0000-0000-000000000003';

  try {
    await ctx.store.insertObservations([
      oldRow(imageRow, project, at(2), `Asked: ${IMAGE}\n\nRemoved the extra banner padding.`),
      oldRow(handbackRow, project, at(4), `Asked: ${HANDBACK}\n\nTightened the header.`),
      oldRow(liveRow, project, at(30), 'Asked: written after the transcript was read'),
      oldRow(manualRow, project, at(3), 'Always run pnpm here', 'manual'),
      oldRow(otherRow, project, at(3), 'Asked: banner padding in another chat', 'another-chat'),
    ]);

    const first = await reingestSession(ctx, project, path);
    const status = async (id) => (await ctx.store.getObservations([id]))[0]?.status;

    check(
      'the typed request is saved with its own words',
      (await ctx.store.getObservations([typedRow]))[0]?.body.startsWith(
        'Asked: the banner gap is too wide, fix it',
      ),
    );
    check(
      'and it carries the work done after the image and the hand-back',
      (await ctx.store.getObservations([typedRow]))[0]?.files.join() ===
        `${project}/src/banner.tsx,${project}/src/header.tsx`,
    );
    check(
      'the old image and hand-back rows are marked replaced, not deleted',
      first.replaced === 2 &&
        (await status(imageRow)) === 'replaced' &&
        (await status(handbackRow)) === 'replaced',
      `${first.replaced} replaced`,
    );
    check('a row newer than the transcript read is left alone', (await status(liveRow)) === 'done');
    check('a manual row is left alone', (await status(manualRow)) === 'done');
    check('a row from another chat is left alone', (await status(otherRow)) === 'done');

    const hits = await ctx.search.search({ text: 'banner padding header', project, limit: 10 });
    check(
      'replaced rows no longer come back from search',
      hits.every((hit) => hit.id !== imageRow && hit.id !== handbackRow) &&
        hits.some((hit) => hit.id === typedRow),
      hits.map((hit) => hit.id.slice(0, 8)).join(','),
    );
    const listed = await ctx.store.list({ project, sessionId: SESSION, limit: 50 });
    check(
      'but they are still in the database, for export and sync',
      listed.filter((obs) => obs.status === 'replaced').length === 2,
    );
    const around = await ctx.search.timeline({ observationId: typedRow, before: 10, after: 10 });
    check(
      'and the timeline skips them',
      around.every((entry) => entry.id !== imageRow && entry.id !== handbackRow),
    );

    const again = await reingestSession(ctx, project, path);
    check(
      'running it again changes nothing',
      again.replaced === 0 && again.saved === first.saved,
      `${again.saved} saved, ${again.replaced} replaced`,
    );

    const onlyHandback = join(dir, `${SESSION}-handback.jsonl`);
    writeFileSync(
      onlyHandback,
      `${[
        user(4, HANDBACK, { isMeta: true, origin: { kind: 'peer' } }),
        edit(5, 'Tightened the header.', `${project}/src/header.tsx`),
      ]
        .map((row) => JSON.stringify(row))
        .join('\n')}\n`,
    );
    const lone = observationId(`${SESSION}-handback`, at(4), HANDBACK);
    await ctx.store.insertObservations([
      oldRow(lone, project, at(4), `Asked: ${HANDBACK}`, `${SESSION}-handback`),
    ]);
    const emptied = await reingestSession(ctx, project, onlyHandback);
    check(
      'a chat left with no real turns still has its old rows replaced',
      emptied.replaced === 1 && (await status(lone)) === 'replaced',
      `${emptied.replaced} replaced`,
    );
  } finally {
    clearCursor(SESSION);
    clearCursor(`${SESSION}-handback`);
    await ctx.close();
  }

  const fake = join(dir, 'marker-project');
  const lock = join(CONFIG_DIR, 'reingest', `${scopeToken(fake)}.lock`);
  const done = join(CONFIG_DIR, 'reingest', `${scopeToken(fake)}.done`);
  try {
    check('a project starts out not re-ingested', !reingestDone(fake));
    check('the first session to start claims the re-ingest', claimReingest(fake));
    check('a second session at the same time does not', !claimReingest(fake));
    const old = (Date.now() - 11 * 60_000) / 1000;
    utimesSync(lock, old, old);
    check('a claim left by a run that died is taken over', claimReingest(fake));
    releaseReingest(fake);
    check('a failed run releases its claim', claimReingest(fake));
    finishReingest(fake);
    check('a finished run is never repeated', reingestDone(fake) && !claimReingest(fake));
  } finally {
    rmSync(lock, { force: true });
    rmSync(done, { force: true });
    try {
      rmdirSync(join(CONFIG_DIR, 'reingest'));
    } catch {}
  }

  const home = join(dir, 'home');
  const broken = join(dir, 'broken-project');
  mkdirSync(broken);
  const real = realpathSync(broken);
  const chats = join(home, '.claude', 'projects', real.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(chats, { recursive: true });
  writeFileSync(
    join(chats, 'chat.jsonl'),
    `${JSON.stringify(user(1, 'hello there', { cwd: real }))}\n`,
  );
  const brokenLock = join(home, '.claude-memory', 'reingest', `${scopeToken(real)}.lock`);
  mkdirSync(join(home, '.claude-memory', 'reingest'), { recursive: true });
  writeFileSync(brokenLock, String(Date.now()));

  const failed = spawnSync(
    process.execPath,
    [
      '--no-warnings',
      new URL('../../dist/cli/index.js', import.meta.url).pathname,
      'flush',
      '--repair',
    ],
    { cwd: real, env: { ...process.env, HOME: home, CLAUDE_DB_URL: chats }, encoding: 'utf8' },
  );
  check(
    'a repair that cannot open the database releases its lock and is retried later',
    failed.status !== 0 &&
      !existsSync(brokenLock) &&
      !existsSync(join(home, '.claude-memory', 'reingest', `${scopeToken(real)}.done`)),
    `exit ${failed.status}`,
  );
  rmSync(dir, { recursive: true, force: true });
}
