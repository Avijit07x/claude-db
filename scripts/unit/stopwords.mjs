import { isStopword, meaningfulTokens } from '../../dist/search/stopwords.js';
import { check } from '../lib/check.mjs';

export default async function run() {
  check('a common word is a stopword', isStopword('for') && isStopword('the'));
  check('a domain word is not', !isStopword('reembed') && !isStopword('embedder'));

  const real = meaningfulTokens('why does reembed run out of memory');
  check(
    'a real question keeps its content words',
    real.join(',') === 'reembed,run,memory',
    real.join(','),
  );

  check(
    'one common word no longer drags in the corpus',
    !meaningfulTokens('quantum entanglement recipes for sourdough').includes('for'),
  );
  check(
    'an all-stopword query reduces to nothing',
    meaningfulTokens('the a of and to it').length === 0,
  );
  check('single characters are dropped', meaningfulTokens('a b c').length === 0);
}
