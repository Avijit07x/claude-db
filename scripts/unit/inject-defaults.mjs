import { check } from '../lib/check.mjs';
import { ConfigSchema } from '../../dist/config/index.js';
import { dropSupersededDefaults } from '../../dist/config/load.js';
import { renderPromptContext } from '../../dist/hooks/relevance.js';

export default async function run() {
  const fresh = ConfigSchema.parse({}).inject;
  check('a fresh install does not pre-expand a body', fresh.expandTop === 0, fresh.expandTop);
  check('a fresh install shows at most two memories with a prompt', fresh.promptResults === 2);
  check('a memory must share two content words with the prompt', fresh.minOverlap === 2);
  check(
    'the char budget fits the number of results asked for',
    fresh.promptMaxChars >= fresh.promptResults * 170,
    `${fresh.promptMaxChars} for ${fresh.promptResults}`,
  );

  {
    const saved = (inject) => ConfigSchema.parse(dropSupersededDefaults({ inject })).inject;
    const untouched = saved({ ...fresh, promptResults: 4, minOverlap: 1 });
    check(
      'a saved config still on the old defaults moves to the new ones',
      untouched.promptResults === 2 && untouched.minOverlap === 2,
      `${untouched.promptResults}/${untouched.minOverlap}`,
    );

    const lastRelease = saved({ ...fresh, promptResults: 3, minOverlap: 2 });
    check(
      'a config saved with the 0.9 defaults moves to two memories',
      lastRelease.promptResults === 2 && lastRelease.minOverlap === 2,
      `${lastRelease.promptResults}/${lastRelease.minOverlap}`,
    );
    const three = saved({ ...fresh, promptResults: 3, minOverlap: 3 });
    check(
      'three memories chosen together with a changed overlap is kept',
      three.promptResults === 3 && three.minOverlap === 3,
      `${three.promptResults}/${three.minOverlap}`,
    );

    const tuned = saved({ ...fresh, promptResults: 5, minOverlap: 1 });
    check(
      'a value the user changed is kept, along with the rest of its release',
      tuned.promptResults === 5 && tuned.minOverlap === 1,
      `${tuned.promptResults}/${tuned.minOverlap}`,
    );

    const ancient = saved({
      ...fresh,
      expandTop: 1,
      promptMaxChars: 500,
      promptResults: 4,
      minOverlap: 1,
    });
    check(
      'a config from two releases back picks up every newer default',
      ancient.expandTop === 0 && ancient.promptMaxChars === 700 && ancient.minOverlap === 2,
      JSON.stringify(ancient),
    );

    const other = { database: '/tmp/x.db', inject: { promptResults: 4, minOverlap: 1 } };
    check(
      'other settings in the file pass through untouched',
      dropSupersededDefaults(other).database === '/tmp/x.db',
    );
    const bare = { updates: 'off' };
    check('a file with no inject block is returned as is', dropSupersededDefaults(bare) === bare);
  }

  const now = Date.UTC(2026, 9, 6, 12);
  const entry = (id, over = {}) => ({
    id: `${id}-0000-0000-0000-000000000000`,
    kind: 'decision',
    title: 'Chose WebSocket over polling for the order feed',
    project: '/p',
    createdAt: Date.UTC(2026, 9, 5, 12),
    score: 0.1,
    ...over,
  });

  const block = renderPromptContext(
    [entry('aaaaaaaa', { snippet: '…matched body text…' })],
    700,
    [],
    900,
    [],
    now,
  );
  const lines = block.split('\n');
  check(
    'the block is wrapped in a memory tag',
    lines[0] === '<memory>' && lines.at(-1) === '</memory>',
  );
  check(
    'a memory is one plain line: day, title, then the id to expand',
    lines[1] === '- Oct 5: Chose WebSocket over polling for the order feed (aaaaaaaa-0000)',
    lines[1],
  );
  check('the matched snippet is not repeated in the block', !block.includes('matched body text'));
  check('no instructions trail the block', !block.includes('get_observations'));

  const lastYear = renderPromptContext(
    [entry('bbbbbbbb', { createdAt: Date.UTC(2025, 2, 9, 12) })],
    700,
    [],
    900,
    [],
    now,
  );
  check(
    'a memory from another year names the year',
    lastYear.includes('- Mar 9, 2025: '),
    lastYear,
  );

  const body = {
    id: 'cccccccc-0000-0000-0000-000000000000',
    sessionId: 's',
    project: '/p',
    kind: 'decision',
    title: 't',
    body: 'first line\nsecond line',
    files: [],
    tags: [],
    createdAt: 0,
  };
  const expanded = renderPromptContext([entry('cccccccc')], 700, [body], 900, [], now);
  check(
    'an expanded body sits indented under its line',
    expanded.includes('(cccccccc-0000)\n  first line\n  second line'),
    expanded,
  );

  const indexOnly = renderPromptContext([entry('dddddddd')], 700, [], 900, [], now);
  const withBody = renderPromptContext(
    [entry('dddddddd')],
    700,
    [{ ...body, id: 'dddddddd-0000-0000-0000-000000000000', body: 'y'.repeat(900) }],
    900,
    [],
    now,
  );
  check(
    'index-only is far cheaper than pre-expanding a body',
    indexOnly.length * 2 < withBody.length,
    `${indexOnly.length} vs ${withBody.length}`,
  );

  const twins = [entry('eeeeeeee'), entry('ffffffff')];
  const shownTwins = [];
  const deduped = renderPromptContext(twins, 700, [], 900, shownTwins, now);
  check(
    'two memories with the same title render once, and both count as shown',
    deduped.split('\n').length === 3 && shownTwins.length === 2,
    deduped,
  );
  check('nothing to show renders nothing', renderPromptContext([], 700) === null);
}
