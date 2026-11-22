import { check } from '../lib/check.mjs';
import { runIsolated } from '../lib/isolated.mjs';
import { LIST_NAMES } from '../lib/rank-lists.mjs';
import { bootstrap, decide, metrics, scoreList } from '../lib/rank-stats.mjs';

const PROMPTS = 40;

function scoring() {
  const score = scoreList(['a', 'b', 'c', 'd'], new Set(['a', 'c']));
  check(
    'a list scores one hit, 2 of the top 3, and 3 of 4 useful-above-other pairs',
    score.hit === 1 && score.top === 2 / 3 && score.wins === 3 && score.pairs === 4,
    JSON.stringify(score),
  );
  const none = scoreList(['a', 'b'], new Set());
  check(
    'a list with no useful note has no AUC pairs',
    none.hit === 0 && none.pairs === 0 && metrics([none]).auc === null,
  );
  const both = metrics([score, scoreList(['x', 'y'], new Set(['y']))]);
  check(
    'the AUC pools pairs over prompts: (3 + 0) / (4 + 1)',
    both.auc === 3 / 5 && both.supply === 1,
    JSON.stringify(both),
  );
}

function perPromptOf(overlapHits) {
  const fused = scoreList(['a', 'b', 'c'], new Set(['a']));
  return Array.from({ length: PROMPTS }, (_, i) => {
    const overlap = scoreList(['a', 'b', 'c'], new Set(i < overlapHits ? ['c'] : []));
    return Object.fromEntries(
      LIST_NAMES.map((name) => [name, name === 'keywordOverlap' ? overlap : fused]),
    );
  });
}

function deciding() {
  const rows = perPromptOf(PROMPTS / 2);
  const runs = bootstrap(rows, LIST_NAMES);
  check(
    'the bootstrap gives the same draws every time',
    JSON.stringify(runs) === JSON.stringify(bootstrap(rows, LIST_NAMES)),
  );
  const clear = decide(rows, runs);
  check(
    'vectors are kept when fused leads by far and the interval stays above zero',
    clear.keepVectors && clear.supply.range[0] > 0,
    JSON.stringify(clear.supply),
  );
  const close = perPromptOf(PROMPTS - 1);
  check(
    'vectors are not kept when the lead is under the bar',
    !decide(close, bootstrap(close, LIST_NAMES)).keepVectors,
  );
}

export default async function run() {
  scoring();
  deciding();
  runIsolated(new URL('./isolated/bench-rank-run.mjs', import.meta.url).pathname);
}
