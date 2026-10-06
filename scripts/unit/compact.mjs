import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../lib/check.mjs';
import { ConfigSchema } from '../../dist/config/index.js';
import { createContext } from '../../dist/context.js';
import { clearCursor } from '../../dist/capture/index.js';
import { recoverAfterCompact, renderEarlierInChat } from '../../dist/hooks/compact.js';
import { markShown, readShown } from '../../dist/hooks/shown.js';
import { toShortId } from '../../dist/util/shortid.js';

const row = (kind, title, status, createdAt, sessionId = 's') => ({
  id: randomUUID(),
  sessionId,
  project: '/p',
  kind,
  title,
  body: title,
  files: [],
  tags: [],
  createdAt,
  status,
});

export default async function run() {
  {
    const newestFirst = [
      row('decision', 'Chose 1.1s for every timer', 'done', 60),
      row('pattern', 'Added right padding to the settings panel', 'open', 50),
      row('context', 'Lint and typecheck pass', 'done', 40),
      row('deadend', 'Banner top space change was undone', 'done', 30),
      row('decision', 'Chose 1.1s for every timer', 'done', 20),
      row('preference', 'Reply in plain text, never in tables', 'done', 10),
    ];
    const earlier = renderEarlierInChat(newestFirst);
    const block = earlier.block;
    const lines = block.split('\n');
    check(
      'the block is headed for what it is',
      lines[0] === '<memory>' && lines[1] === 'Earlier in this chat:',
    );
    check(
      'lines read in the order things happened, each labelled',
      lines
        .slice(2, -1)
        .map((line) => line.replace(/ \(.+\)$/, ''))
        .join('|') ===
        [
          '- Rule: Reply in plain text, never in tables',
          '- Dead end: Banner top space change was undone',
          '- Not committed: Added right padding to the settings panel',
          '- Decided: Chose 1.1s for every timer',
        ].join('|'),
      lines.join(' | '),
    );
    check(
      'each line carries the id to expand',
      block.includes(`(${toShortId(newestFirst[0].id)})`),
    );
    check('finished routine work is left out', !block.includes('Lint and typecheck pass'));
    check(
      'it reports every row the block covers, a repeated title included',
      earlier.ids.size === 5 &&
        earlier.ids.has(newestFirst[0].id) &&
        earlier.ids.has(newestFirst[4].id) &&
        !earlier.ids.has(newestFirst[2].id),
    );
    check(
      'a repeated decision appears once, as its newest copy',
      block.split('Chose 1.1s').length === 2 && !block.includes(toShortId(newestFirst[4].id)),
    );

    const many = Array.from({ length: 20 }, (_, i) =>
      row('decision', `Decision ${20 - i}`, 'done', 20 - i),
    );
    const capped = renderEarlierInChat(many).block.split('\n').slice(2, -1);
    check(
      'a long chat keeps its eight newest, still in order',
      capped.length === 8 &&
        capped[0].startsWith('- Decided: Decision 13') &&
        capped[7].startsWith('- Decided: Decision 20'),
      capped.join(' | '),
    );

    check(
      'nothing worth restoring renders nothing',
      renderEarlierInChat([row('context', 'Read the README', 'done', 1)]) === null &&
        renderEarlierInChat([]) === null,
    );
  }

  {
    const dir = mkdtempSync(join(tmpdir(), 'compact-'));
    const defaults = ConfigSchema.parse({});
    const ctx = await createContext({
      database: join(dir, 'memory.db'),
      embeddings: { ...defaults.embeddings, provider: 'none' },
    });
    const session = 'unit-compact-test';
    const project = join(dir, 'project');
    try {
      const mine = {
        ...row('decision', 'Kept the order feed on websockets', 'done', 2, session),
        project,
      };
      const theirs = {
        ...row('decision', 'Moved billing to a queue', 'done', 1, 'another-chat'),
        project,
      };
      await ctx.store.insertObservations([mine, theirs]);
      markShown(session, [theirs.id]);

      const block = (await recoverAfterCompact(ctx, project, session, join(dir, 'missing.jsonl')))
        ?.block;
      check(
        'a compaction restores this chat’s decisions',
        block?.includes('Kept the order feed on websockets'),
      );
      check('and nothing from other chats', !block?.includes('Moved billing to a queue'));
      check('what the chat was shown before is forgotten', readShown(session).size === 0);
    } finally {
      clearCursor(session);
      await ctx.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
