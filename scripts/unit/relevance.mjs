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
}
