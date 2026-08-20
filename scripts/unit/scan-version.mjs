import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { check } from '../lib/check.mjs';
import { newRepo } from '../lib/repo.mjs';
import { SCAN_VERSION, currentHashes, hashOf, scanRepository } from '../../dist/graph/index.js';

export default async function run() {
  const { repo, git } = newRepo('scanver-');
  writeFileSync(join(repo, 'a.ts'), 'export function alpha() {\n  return 1;\n}\n');
  git('add', '-A');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=a', 'commit', '-qm', 'seed');

  const bytes = readFileSync(join(repo, 'a.ts'));
  check('the scan version is exposed', typeof SCAN_VERSION === 'number' && SCAN_VERSION >= 1);
  check(
    'the cache key is not a bare content hash',
    hashOf(bytes) !== createHash('sha256').update(bytes).digest('hex').slice(0, 32),
  );

  // A cache written by an older extractor: content hashes with no version mixed in.
  const stale = new Map();
  for (const [path] of currentHashes(repo)) {
    stale.set(
      path,
      createHash('sha256')
        .update(readFileSync(join(repo, path)))
        .digest('hex')
        .slice(0, 32),
    );
  }
  const upgraded = scanRepository({ root: repo, project: repo, known: stale });
  check(
    'an upgrade reparses instead of serving the old graph',
    upgraded.skipped === 0 && upgraded.changed.length > 0,
    `parsed ${upgraded.changed.length}, skipped ${upgraded.skipped}`,
  );

  // With a current cache, skipping must still work or every scan gets slow.
  const fresh = new Map(upgraded.files.map((f) => [f.path, f.hash]));
  const again = scanRepository({ root: repo, project: repo, known: fresh });
  check(
    'an unchanged file is still skipped',
    again.changed.length === 0 && again.skipped > 0,
    `parsed ${again.changed.length}, skipped ${again.skipped}`,
  );
}
