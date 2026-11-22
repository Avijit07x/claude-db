import { fuse, applyRecencyBoost, SearchService } from '../../dist/search/index.js';
import { NoopEmbedder } from '../../dist/embed/index.js';
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

  const seen = [];
  const keywordStore = (results) => ({
    searchKeyword: async (query) => {
      seen.push(query);
      return results;
    },
    searchVector: async () => [],
  });
  const service = (results) => new SearchService(keywordStore(results), new NoopEmbedder());

  await service([e('x', 1)]).search({ text: '-websocket "reconnect storm" OR NEAR(a', limit: 5 });
  check(
    'keyword search gets plain words, never operators or quotes',
    seen[0]?.text === 'websocket reconnect storm near',
    seen[0]?.text,
  );

  const until = now - 400 * day;
  const olderAtThatTime = { ...e('older', 1), createdAt: until - 400 * day };
  const newerAtThatTime = { ...e('newer', 1), createdAt: until - day };
  const ranked = await service([olderAtThatTime, newerAtThatTime]).search({
    text: 'websocket',
    until,
    limit: 5,
  });
  check(
    'recency counts age at the until time, not today',
    ranked[0]?.id === 'newer',
    ranked.map((r) => r.id).join(','),
  );
}
