import { check } from '../lib/check.mjs';
import { e, now, day } from '../lib/fixtures.mjs';

export default async function run() {
  {
    const { compareVersions, isCompatible, isDue } = await import('../../dist/update.js');

    check('versions compare numerically, not as strings', compareVersions('0.2.10', '0.2.9') === 1);
    check('equal versions compare equal', compareVersions('1.2.3', '1.2.3') === 0);
    check('older compares lower', compareVersions('0.2.2', '0.3.0') === -1);

    check(
      '0.x auto-updates only within the same minor',
      isCompatible('0.2.2', '0.2.9') && !isCompatible('0.2.2', '0.3.0'),
    );
    check(
      '1.x auto-updates across minors',
      isCompatible('1.2.0', '1.9.4') && !isCompatible('1.2.0', '2.0.0'),
    );

    check('a check is due when never run', isDue({}));
    check('and not again within the day', !isDue({ checkedAt: Date.now() }));
    check(
      'but is due after one',
      !isDue({ checkedAt: Date.now() - 23 * 3600_000 }) &&
        isDue({ checkedAt: Date.now() - 25 * 3600_000 }),
    );
  }
}
