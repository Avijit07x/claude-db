import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../lib/check.mjs';
import { ConfigSchema } from '../../dist/config/index.js';
import { createContext } from '../../dist/context.js';
import { embedObservations } from '../../dist/capture/index.js';
import { promptCandidates, strictRecall } from '../../dist/hooks/prompt-recall.js';
import { pickMemories } from '../../dist/pick/run.js';

const HOUR = 3_600_000;
const PROMPT = 'why did we drop polling for the websocket order feed';

export default async function run() {
  const dir = mkdtempSync(join(tmpdir(), 'prompt-recall-'));
  const defaults = ConfigSchema.parse({});
  const open = (inject = {}) =>
    createContext({
      database: join(dir, 'memory.db'),
      inject: { ...defaults.inject, ...inject },
      embeddings: { ...defaults.embeddings, provider: 'builtin' },
    });

  const project = '/p/shop';
  const now = Date.now();
  const row = (sessionId, title, body, age) => ({
    id: randomUUID(),
    sessionId,
    project,
    kind: 'decision',
    title,
    body,
    files: [],
    tags: [],
    createdAt: now - age,
  });

  const past = row(
    'earlier-chat',
    'Dropped polling for the websocket order feed',
    'Polling every 3s hammered the API, so the order feed moved to a websocket subscription.',
    48 * HOUR,
  );
  const sameChat = row(
    'this-chat',
    'Websocket order feed reconnects with backoff',
    'The order feed websocket now reconnects with exponential backoff.',
    HOUR,
  );
  const weak = row(
    'earlier-chat',
    'Rounded order totals to cents',
    'Totals round half up.',
    72 * HOUR,
  );
  const recent = row(
    'other-chat',
    'Polling removed from the order feed for good',
    'Nothing polls the order feed any more.',
    60_000,
  );

  const ctx = await open();
  try {
    const rows = [past, sameChat, weak, recent];
    await embedObservations(ctx, rows);
    await ctx.store.insertObservations(rows);

    const request = (over = {}) => ({
      prompt: PROMPT,
      project,
      sessionId: 'this-chat',
      shown: new Set(),
      ...over,
    });
    const candidateIds = async (over = {}) =>
      (await promptCandidates(ctx, request(over)))?.entries.map((entry) => entry.id) ?? null;
    const ask = async (over = {}) => {
      const candidates = await promptCandidates(ctx, request(over));
      return candidates ? strictRecall(ctx, candidates) : null;
    };

    const ids = await candidateIds();
    check('a related prompt gets candidates', ids !== null);
    check('a memory from an earlier chat is a candidate', ids?.includes(past.id));
    check('a memory from this same chat is not', !ids?.includes(sameChat.id));
    check(
      'a prompt sharing too few words with every memory gets nothing',
      (await candidateIds({ prompt: 'just show the totals please, nothing else today' })) === null,
    );

    const recall = await ask();
    check('without Haiku, a strong word match is shown', recall?.ids.includes(past.id));
    check('without Haiku, at most one memory is shown', recall?.ids.length === 1);
    const lines = recall?.block.split('\n') ?? [];
    check(
      'a fallback line is a day, a title and an id',
      lines
        .slice(1, -1)
        .every((line) => /^- [A-Z][a-z]{2} \d{1,2}: .+ \([0-9a-f]{8}-[0-9a-f]{4}\)$/.test(line)),
      lines.join(' | '),
    );
    check(
      'a weaker match is not shown without Haiku',
      (await ask({ prompt: 'the order feed is slow on mobile' })) === null,
    );

    const seen = await candidateIds({ shown: new Set([past.id]) });
    check('a row this chat was already shown is skipped', !seen?.includes(past.id));

    const earlier = await candidateIds({ until: now - 24 * HOUR });
    check(
      'nothing newer than the cutoff is a candidate',
      earlier !== null && !earlier.includes(recent.id) && earlier.includes(past.id),
    );

    const asked = row(
      'earlier-chat',
      'The feed moved off polling',
      'Asked: should the order feed keep polling every few seconds?\n\nPolling every 3s hammered the API, so the order feed moved to a websocket subscription.',
      30 * HOUR,
    );
    await embedObservations(ctx, [asked]);
    await ctx.store.insertObservations([asked]);
    let sent = '';
    const reply = (stdout) => async (prompt) => {
      sent = prompt;
      return stdout;
    };
    const pick = (stdout, previousReply = 'I will look at the feed next.') =>
      pickMemories(ctx, { prompt: PROMPT, previousReply, ids: [past.id, asked.id] }, reply(stdout));

    const picked = await pick(
      JSON.stringify({
        picks: [
          {
            id: 'm2',
            quote:
              'Polling every 3s hammered the API, so the order feed moved to a websocket subscription.',
          },
        ],
      }),
    );
    check('Haiku sees the previous reply', sent.includes('I will look at the feed next.'));
    check(
      'Haiku sees the prompt and every candidate',
      sent.includes(PROMPT) && sent.includes('"m2"'),
    );
    check(
      'a pick with an exact quote is shown',
      picked.kind === 'picked' && picked.ids[0] === asked.id,
    );
    check(
      'a picked line is the earlier question and the quote',
      picked.kind === 'picked' &&
        /^- [A-Z][a-z]{2} \d{1,2}: asked "should the order feed keep polling every few seconds\?": Polling every 3s hammered the API, so the order feed moved to a websocket subscription\. \([0-9a-f]{8}-[0-9a-f]{4}\)$/.test(
          picked.block.split('\n')[1],
        ),
      picked.kind === 'picked' ? picked.block : picked.kind,
    );
    const reworded = await pick(
      JSON.stringify({
        picks: [{ id: 'm2', quote: 'Polling was too heavy so we switched to websockets.' }],
      }),
    );
    check('a pick whose quote is not in the memory is dropped', reworded.kind === 'none');
    check('an empty pick shows nothing', (await pick('{"picks": []}')).kind === 'none');
    check('a failed Haiku call is reported as failed', (await pick(null)).kind === 'failed');
    await pick('{"picks": []}', '');
    check('the first prompt of a chat says so to Haiku', sent.includes('(start of chat)'));

    const handback = await candidateIds({
      prompt: `Another Claude session sent a message:\n<agent-message from="a1">${PROMPT}</agent-message>`,
    });
    check('a subagent hand-back gets no memory', handback === null);

    check(
      'an image with no text gets no memory',
      (await candidateIds({ prompt: '[Image: source: /tmp/a.png]' })) === null,
    );
    const withImage = await candidateIds({
      prompt: `[Image: source: /tmp/claude/images/1.png] ${PROMPT}`,
    });
    check('an image with a typed question still gets memory', withImage?.includes(past.id));

    check('filler gets no memory', (await candidateIds({ prompt: 'ok go ahead' })) === null);
  } finally {
    await ctx.close();
  }

  const off = await open({ perPrompt: false });
  try {
    const candidates = await promptCandidates(off, {
      prompt: PROMPT,
      project,
      sessionId: 'this-chat',
      shown: new Set(),
    });
    check('perPrompt off injects nothing', candidates === null);
  } finally {
    await off.close();
  }

  rmSync(dir, { recursive: true, force: true });
}
