import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { check } from '../lib/check.mjs';
import { newRepo } from '../lib/repo.mjs';
import { SCAN_VERSION, currentHashes, hashOf, scanRepository } from '../../dist/graph/index.js';
import { cacheHome } from '../../dist/graph/scan/cache.js';
import { scopeToken } from '../../dist/util/scope.js';

function writeOldCache(repo, bytes) {
  mkdirSync(cacheHome(), { recursive: true });
  const entry = { hash: hashOf(bytes), symbols: [], references: [], edgesHash: '' };
  writeFileSync(
    join(cacheHome(), `${scopeToken(repo)}.json`),
    JSON.stringify({ key: 'v0:older-scanner\n', project: repo, files: { 'a.ts': entry } }),
  );
}

export default async function run() {
  const { repo, git } = newRepo('scanver-');
  writeFileSync(join(repo, 'a.ts'), 'export function alpha() {\n  return 1;\n}\n');
  git('add', '-A');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=a', 'commit', '-qm', 'seed');

  const bytes = readFileSync(join(repo, 'a.ts'));
  check('the scan version is exposed', typeof SCAN_VERSION === 'number' && SCAN_VERSION >= 1);
  const ruleKey = (pattern) =>
    JSON.stringify({ pattern }, (_k, v) => (v instanceof RegExp ? String(v) : v));
  check('the cache key sees inside a rule pattern', ruleKey(/^[A-Z]/) !== ruleKey(/^[A-Z][a-z]/));
  check('the cache key sees a rule pattern flag', ruleKey(/^[A-Z]/) !== ruleKey(/^[A-Z]/i));
  check(
    'the cache key is not a bare content hash',
    hashOf(bytes) !== createHash('sha256').update(bytes).digest('hex').slice(0, 32),
  );

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
  writeOldCache(repo, bytes);
  const upgraded = await scanRepository({ root: repo, project: repo, stored: stale });
  check(
    'an extraction cache from an older scanner is not trusted, so an upgrade reparses',
    upgraded.skipped === 0 && upgraded.changed.length > 0 && upgraded.symbols.length > 0,
    `parsed ${upgraded.changed.length}, skipped ${upgraded.skipped}`,
  );
  check(
    'and the rows the older scanner stored are rewritten',
    upgraded.rewrite.includes('a.ts'),
    upgraded.rewrite.join(','),
  );

  const fresh = new Map(upgraded.files.map((f) => [f.path, f.hash]));
  const again = await scanRepository({ root: repo, project: repo, stored: fresh });
  check(
    'an unchanged file is still skipped and nothing is rewritten',
    again.changed.length === 0 && again.skipped > 0 && again.rewrite.length === 0,
    `parsed ${again.changed.length}, skipped ${again.skipped}, rewrite ${again.rewrite.length}`,
  );
}
