import { check } from '../lib/check.mjs';

export default async function run() {
  {
    const { renderIndex, renderFull } = await import('../../dist/mcp/render.js');
    const row = (over = {}) => ({
      id: '31ad1fc9-f168-800b-28f2-d529d2ff4cc2',
      kind: 'decision',
      title: 'Committed as 30daa92',
      project: '/p',
      createdAt: Date.parse('2026-08-15'),
      score: 0.03,
      ...over,
    });

    const shown = renderIndex([row({ snippet: 'the cursor sweep runs during flush' })]);
    check(
      'the index shows the snippet under the title',
      shown.includes('Committed as 30daa92\n    the cursor sweep runs'),
      JSON.stringify(shown),
    );
    check(
      'a row without a snippet renders on one line',
      renderIndex([row()]).split('\n').length === 2,
      JSON.stringify(renderIndex([row()])),
    );
    check('an empty result set still says so', renderIndex([]) === 'No matching observations.');

    const echo = renderIndex([
      row({
        title: 'Added as section 3 of PLAN.md, with the later sections renumbered',
        snippet: '…ok do Added as section 3 of [PLAN.md](PLAN.md), with the later…',
      }),
    ]);
    check(
      'a snippet that only restates the title is dropped',
      echo.split('\n').length === 2,
      JSON.stringify(echo),
    );

    const overlapping = renderIndex([
      row({
        title: "J1's guard was wrong — a stalled project with zero captures",
        snippet: '…Now the CLI side of J1, J5 and J8. Now the cursor sweep in…',
      }),
    ]);
    check(
      'a fragment sharing some words with the title survives',
      overlapping.includes('the cursor sweep in'),
      JSON.stringify(overlapping),
    );

    const full = renderFull(
      { ...row(), body: 'b'.repeat(9000), files: ['/p/a.ts'], author: 'ada' },
      2000,
    );
    check('layer 3 bounds the body it returns', full.includes('7000 more characters'));

    const fact = renderFull(
      row({
        files: [],
        title: 'Timers fire after 1.1s.',
        body: 'Timers fire after 1.1s.\n\nWhy: They fired too early.\n\nFrom a chat on Nov 22 (abcd1234).',
      }),
      2000,
    );
    check(
      'a fact prints its text once',
      fact.split('Timers fire after 1.1s.').length === 2 &&
        fact.includes('Why: They fired too early.'),
      JSON.stringify(fact),
    );
    const turnRow = renderFull(
      row({ title: 'Built the icon', body: 'Asked: add an icon\n\nBuilt it.', files: [] }),
      2000,
    );
    check(
      'a turn row prints its title and its whole body',
      turnRow.includes('Built the icon\n\nAsked: add an icon'),
    );
    check(
      'layer 3 keeps the metadata header',
      full.includes('who: ada') && full.includes('files: /p/a.ts'),
    );
  }
}
