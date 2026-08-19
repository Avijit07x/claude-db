import { check } from '../lib/check.mjs';
import { ConfigSchema } from '../../dist/config/index.js';
import { renderPromptContext } from '../../dist/hooks/relevance.js';

export default async function run() {
  const fresh = ConfigSchema.parse({}).inject;
  check('a fresh install does not pre-expand a body', fresh.expandTop === 0, fresh.expandTop);
  check(
    'the char budget fits the number of results asked for',
    fresh.promptMaxChars >= fresh.promptResults * 170,
    `${fresh.promptMaxChars} for ${fresh.promptResults}`,
  );

  const entry = (id, snippet) => ({
    id: `${id}-0000-0000-0000-000000000000`,
    kind: 'decision',
    title: 'A title that reads like a claim',
    project: '/p',
    createdAt: 0,
    score: 0.1,
    ...(snippet ? { snippet } : {}),
  });

  const withSnippet = renderPromptContext([entry('aaaaaaaa', '…the matched line…')], 700, []);
  check('an index line carries the matched snippet', withSnippet.includes('…the matched line…'));
  check('and still carries the id to expand', withSnippet.includes('aaaaaaaa'));

  const bare = renderPromptContext([entry('bbbbbbbb')], 700, []);
  check('a result with no snippet still renders', bare.includes('bbbbbbbb'));

  const indexOnly = renderPromptContext([entry('cccccccc', 'x'.repeat(100))], 700, []);
  const expanded = renderPromptContext(
    [entry('cccccccc', 'x'.repeat(100))],
    700,
    [
      {
        id: 'cccccccc-0000-0000-0000-000000000000',
        sessionId: 's',
        project: '/p',
        kind: 'decision',
        title: 'A title that reads like a claim',
        body: 'y'.repeat(900),
        files: [],
        tags: [],
        createdAt: 0,
      },
    ],
    900,
  );
  check(
    'index-only is far cheaper than pre-expanding a body',
    indexOnly.length * 2 < expanded.length,
    `${indexOnly.length} vs ${expanded.length}`,
  );
}
