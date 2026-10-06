import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { scanText } from './lib/fixture-scan.mjs';
import { findPrivateOverlap } from './lib/private-overlap.mjs';

const TEXT_FILE = /\.(mjs|js|ts|tsx|md|mdx|json|yml|yaml|css)$/;
const LOCK_FILE = /(^|\/)package-lock\.json$/;
const ROOTS =
  /^(scripts\/|docs\/|site\/content\/|src\/|README\.md$|CHANGELOG\.md$|CONTRIBUTING\.md$|SECURITY\.md$)/;
const local = process.argv.includes('--local');

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter((file) => file && TEXT_FILE.test(file) && ROOTS.test(file) && !LOCK_FILE.test(file));

const texts = new Map();
for (const file of files) {
  try {
    texts.set(file, readFileSync(file, 'utf8'));
  } catch {
    continue;
  }
}

let failures = 0;
for (const [file, text] of texts) {
  for (const found of scanText(file, text)) {
    failures += 1;
    console.error(`${found.file}:${found.line}  ${found.rule}  ${found.text}`);
  }
}

if (local) {
  for (const { file, count, example } of await findPrivateOverlap(texts)) {
    failures += 1;
    console.error(
      `${file}  ${count} six-word run(s) also in your own memory or chats, e.g. "${example}"`,
    );
  }
}

if (failures > 0) {
  console.error(`\n${failures} fixture problem(s). Replace them with invented text.`);
  process.exit(1);
}
console.log(
  `Fixture check passed (${texts.size} files${local ? ', compared with your own memory and chats' : ''}).`,
);
