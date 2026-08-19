import { check } from '../lib/check.mjs';
import { e, now, day } from '../lib/fixtures.mjs';

export default async function run() {
  {
    const { toSnippet, clipBody } = await import('../../dist/util/snippet.js');

    check(
      'a snippet collapses to one line',
      toSnippet('first line\n\nsecond   line') === 'first line second line',
      toSnippet('first line\n\nsecond line'),
    );
    check(
      'search-engine match markers are stripped',
      toSnippet('the <b>cursor</b> was stale') === 'the cursor was stale',
    );
    check(
      'markdown table pipes are stripped',
      !toSnippet('| a | b |').includes('|'),
      toSnippet('| a | b |'),
    );
    check(
      'identifiers survive intact',
      toSnippet('at aggregation_cursor.js:46').includes('aggregation_cursor.js'),
      toSnippet('at aggregation_cursor.js:46'),
    );
    check('an empty body yields no snippet', toSnippet('   ') === undefined);
    check('a missing body yields no snippet', toSnippet(undefined) === undefined);
    check(
      'a long snippet is cut at a word boundary',
      toSnippet('x'.repeat(20) + ' ' + 'word '.repeat(40), 40).endsWith('…'),
      toSnippet('x'.repeat(20) + ' ' + 'word '.repeat(40), 40),
    );

    check('a short body is returned whole', clipBody('short', 2000) === 'short');
    const clipped = clipBody('y'.repeat(5000), 2000);
    check('a long body is bounded', clipped.startsWith('y'.repeat(2000)) && clipped.length < 2100);
    check(
      'and says how much was withheld',
      clipped.includes('3000 more characters'),
      clipped.slice(-60),
    );
  }
}
