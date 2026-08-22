import { check } from '../lib/check.mjs';
import { e, now, day } from '../lib/fixtures.mjs';

export default async function run() {
  {
    const { isSearchable } = await import('../../dist/util/prompt.js');
    const foreign = ['修复登录接口的超时问题', 'ログイン画面のバグ', 'почему падает сборка'];
    check(
      'non-latin prompts reach search',
      foreign.every(isSearchable),
      foreign.filter((p) => !isSearchable(p)).join(' '),
    );
    check('english prompts still reach search', isSearchable('fix the login timeout bug'));
    check(
      'filler is still rejected',
      !isSearchable('ok') && !isSearchable('thanks') && !isSearchable('go ahead'),
    );
  }

  {
    const { overlapCount } = await import('../../dist/hooks/relevance.js');
    const related = overlapCount('why does the flush cursor skip transcript turns', {
      title: 'Fixed the flush cursor drift',
      snippet: 'the cursor was written before the transcript insert',
    });
    check('a related prompt/entry pair clears the gate', related >= 2, String(related));

    const unrelated = overlapCount('how do we publish a release', {
      title: '| SQLite | 2-5 ms |',
    });
    check('table-row junk scores zero', unrelated === 0, String(unrelated));

    check(
      'stopwords never count as overlap',
      overlapCount('what is the thing for it', { title: 'the thing is what it is for' }) ===
        overlapCount('thing', { title: 'thing' }),
    );
  }
}
