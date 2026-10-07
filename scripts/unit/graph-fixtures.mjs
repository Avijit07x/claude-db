import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../lib/check.mjs';
import { project } from '../lib/graph-scan.mjs';
import { describeGraph, differences, parseFixture, writeFixture } from '../lib/graph-fixtures.mjs';

const HOME = fileURLToPath(new URL('./fixtures/graph/', import.meta.url));
const EXTENSION = '.txt';
const UPDATE = process.env.CLAUDE_DB_UPDATE_FIXTURES === '1';

const sorted = (names) => [...names].sort();

function runFixture(language, file) {
  const path = join(HOME, language, file);
  const { files, expected } = parseFixture(readFileSync(path, 'utf8'));
  const { symbols, edges, done } = project(files);
  const actual = describeGraph(symbols, edges);
  done();
  if (UPDATE) writeFileSync(path, writeFixture(files, actual));
  const changed = UPDATE ? [] : differences(expected, actual);
  const claim = file.slice(0, -EXTENSION.length).replaceAll('-', ' ');
  check(`${language}: ${claim}`, changed.length === 0, changed.join('\n'));
}

export default async function run() {
  for (const language of sorted(readdirSync(HOME))) {
    const cases = readdirSync(join(HOME, language)).filter((name) => name.endsWith(EXTENSION));
    for (const file of sorted(cases)) runFixture(language, file);
  }
}
