import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../lib/check.mjs';
import {
  GRAMMARS,
  PLATFORM,
  PLATFORM_PACKAGE,
  findGrammar,
  isUsable,
} from '../../dist/graph/grammars.js';
import { build, link, PLATFORMS } from '../grammars.mjs';

const ROOT_VERSION = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
).version;

const loaderIn = (dir) => createRequire(join(dir, 'package.json'));

function withPackage(dir) {
  build({ out: join(dir, 'node_modules'), platforms: [PLATFORM] });
  return join(dir, 'node_modules', PLATFORM_PACKAGE);
}

function brokenPackage(dir, libraryPath) {
  const folder = join(dir, 'node_modules', PLATFORM_PACKAGE);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, 'package.json'),
    JSON.stringify({ name: PLATFORM_PACKAGE, main: 'index.js' }),
  );
  writeFileSync(
    join(folder, 'index.js'),
    `module.exports = { kotlin: { libraryPath: ${JSON.stringify(libraryPath)} } };\n`,
  );
}

function builtPackage(home) {
  const folder = withPackage(home);
  const manifest = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
  const target = PLATFORMS[PLATFORM];
  check(
    'a grammar package names its platform, so npm installs it only there',
    manifest.version === ROOT_VERSION &&
      manifest.os?.[0] === target.os &&
      manifest.cpu?.[0] === target.cpu &&
      (target.os !== 'linux' || manifest.libc?.[0] === 'glibc'),
    JSON.stringify(manifest),
  );
  const notice = readFileSync(join(folder, 'NOTICE'), 'utf8');
  check(
    'it holds every grammar with its licence and where it came from',
    GRAMMARS.every(
      (name) =>
        existsSync(join(folder, `${name}.so`)) &&
        existsSync(join(folder, `LICENSE-${name}`)) &&
        notice.includes(`${name}.so: @ast-grep/lang-${name}@`),
    ),
    notice,
  );

  const found = findGrammar('kotlin', [loaderIn(home)]);
  check(
    'a present grammar package is used first',
    found?.libraryPath === join(folder, 'kotlin.so') &&
      found.languageSymbol === 'tree_sitter_kotlin',
    found?.libraryPath,
  );
}

function missingAndBroken(home) {
  const empty = join(home, 'empty');
  mkdirSync(empty);
  check(
    'with no grammar package, no grammar is found and nothing is downloaded',
    findGrammar('kotlin', [loaderIn(empty)]) === undefined,
  );

  const gone = join(home, 'gone');
  brokenPackage(gone, join(gone, 'missing.so'));
  const blank = join(home, 'blank');
  brokenPackage(blank, join(blank, 'blank.so'));
  writeFileSync(join(blank, 'blank.so'), '');
  const good = join(home, 'good');
  withPackage(good);
  check(
    'a grammar whose library is missing or empty is skipped for the next place',
    findGrammar('kotlin', [loaderIn(gone)]) === undefined &&
      findGrammar('kotlin', [loaderIn(blank)]) === undefined &&
      findGrammar('kotlin', [loaderIn(gone), loaderIn(blank), loaderIn(good)])?.libraryPath ===
        join(good, 'node_modules', PLATFORM_PACKAGE, 'kotlin.so'),
  );
  check(
    'a grammar with no library path at all is not usable',
    !isUsable({}) && !isUsable(null) && !isUsable({ libraryPath: '' }),
  );
}

function linked(home) {
  const manifest = join(home, 'package.json');
  copyFileSync(new URL('../../package.json', import.meta.url), manifest);
  link(manifest);
  const optional = JSON.parse(readFileSync(manifest, 'utf8')).optionalDependencies ?? {};
  check(
    'publishing links claude-db to every grammar package at its own version',
    Object.keys(PLATFORMS).every(
      (platform) => optional[`claude-db-grammars-${platform}`] === ROOT_VERSION,
    ),
    JSON.stringify(optional),
  );
}

export default async function run() {
  const home = mkdtempSync(join(tmpdir(), 'grammars-'));
  try {
    builtPackage(join(home, 'built'));
    missingAndBroken(home);
    linked(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
