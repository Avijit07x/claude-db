import { fuse, applyRecencyBoost } from '../../dist/search/index.js';
import { check } from '../lib/check.mjs';
import { e, now, day } from '../lib/fixtures.mjs';

export default async function run() {
  const fused = fuse(
    [
      [e('a'), e('b'), e('c')],
      [e('c'), e('a'), e('z')],
    ],
    3,
  );
  check(
    'fusion rewards agreement across retrievers',
    fused[0].id === 'a',
    fused.map((f) => f.id).join(','),
  );
  check(
    'fusion keeps items seen by only one retriever',
    fused.some((f) => f.id === 'z' || f.id === 'b'),
  );
  const magnitude = fuse([[e('loser', 9999), e('filler', 5000)], [e('winner', 0.00001)]], 3);
  check(
    'fusion ignores raw score magnitude',
    magnitude[0].id === 'loser' &&
      magnitude[1].id === 'winner' &&
      magnitude[1].score > magnitude[2].score,
    magnitude.map((m) => m.id).join(','),
  );

  const boosted = applyRecencyBoost(
    [e('old', 1), { ...e('new', 1), createdAt: now }].map((x) => ({
      ...x,
      createdAt: x.createdAt || now - 400 * day,
    })),
    now,
  );
  check(
    'recency breaks ties toward newer',
    boosted[0].id === 'new',
    boosted.map((b) => b.id).join(','),
  );
}
