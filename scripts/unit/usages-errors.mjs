import { check } from '../lib/check.mjs';

export default async function run() {
  {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { findUsages } = await import('../../dist/usages/index.js');

    const plain = mkdtempSync(join(tmpdir(), 'notrepo-'));
    let threw = false;
    try {
      findUsages({ symbol: 'x', path: plain, regex: false, context: 0, limit: 10 });
    } catch {
      threw = true;
    }
    check('a plain directory that is not a git repo throws a clear error', threw);
    rmSync(plain, { recursive: true, force: true });
  }
}
