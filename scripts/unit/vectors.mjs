import { check } from '../lib/check.mjs';
import { e, now, day } from '../lib/fixtures.mjs';

export default async function run() {
  {
    const { cosine } = await import('../../dist/util/vector.js');
    check('same-width vectors score normally', cosine([1, 0], [1, 0]) === 1);
    check('mismatched widths never score', cosine([1, 0, 0], [1, 0]) === 0);
  }
}
