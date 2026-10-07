import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../lib/check.mjs';
import { newRepo } from '../lib/repo.mjs';
import {
  answerQuery,
  formatGraph,
  formatText,
  saveScan,
  scanRepository,
} from '../../dist/graph/index.js';
import { unlinkedText } from '../../dist/graph/query/text.js';
import { createStore } from '../../dist/store/index.js';

function seed() {
  const { repo, git } = newRepo('graph-answer-');
  mkdirSync(join(repo, 'src'));
  writeFileSync(
    join(repo, 'src', 'x.ts'),
    'export function readJson() {\n  return 1;\n}\nexport function useX() {\n  return readJson();\n}\n',
  );
  writeFileSync(
    join(repo, 'src', 'y.ts'),
    'function readJson() {\n  return 2;\n}\nexport function useY() {\n  return readJson();\n}\n',
  );
  writeFileSync(
    join(repo, 'src', 'w.ts'),
    'export class Widget {\n  render() {\n    return 1;\n  }\n}\n',
  );
  writeFileSync(join(repo, 'README.md'), 'Call readJson to read a file.\n');
  writeFileSync(join(repo, 'tool.php'), "<?php\n$parsed = array_map('readJson', $rows);\n");
  git('add', '-A');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=a', 'commit', '-qm', 'seed');
  return repo;
}

const blockOf = (text, file, symbol = 'readJson') => {
  const start = text.indexOf(`Source: ${file}`);
  const ends = [`${symbol}  [`, 'Matched by name']
    .map((part) => text.indexOf(part, start + 1))
    .filter((at) => at >= 0);
  return text.slice(start, ends.length > 0 ? Math.min(...ends) : undefined);
};

const occurrences = (text, part) => text.split(part).length - 1;

const definition = (id, file) => ({
  id,
  project: '/p',
  name: 'find',
  kind: 'method',
  file,
  line: 2,
  lang: 'java',
  signature: '',
});

const call = (dstId, line, confidence) => ({
  id: `e${line}`,
  project: '/p',
  srcId: 'run',
  srcName: 'run',
  dstId,
  dstName: 'find',
  relation: 'calls',
  confidence,
  score: confidence === 'INFERRED' ? 0.85 : 1,
  file: 'src/Use.java',
  line,
});

function guessedCalls() {
  const answer = {
    mode: 'usages',
    symbol: 'find',
    definitions: [definition('a', 'src/A.java'), definition('b', 'src/B.java')],
    inbound: [call('a', 7, 'EXTRACTED'), call('a', 9, 'INFERRED')],
    outbound: [],
    path: [],
    refreshed: [],
    empty: false,
    suggestions: [],
  };
  const text = formatGraph(answer, '/p', { text: false });
  const heading = 'Matched by name, could be any of the 2 definitions above (1):';
  const guessed = text.slice(text.indexOf(heading));
  check(
    'a guessed call is listed once under all the definitions it could be, not under one',
    blockOf(text, 'src/A.java', 'find').includes('src/Use.java:7') &&
      !blockOf(text, 'src/A.java', 'find').includes('src/Use.java:9') &&
      guessed.includes('src/Use.java:9') &&
      occurrences(text, 'src/Use.java:9') === 1,
    text,
  );
}

export default async function run() {
  guessedCalls();
  const repo = seed();
  const dir = mkdtempSync(join(tmpdir(), 'graph-answer-db-'));
  const store = await createStore(join(dir, 'memory.db'));
  await store.init();
  try {
    await saveScan(store, repo, await scanRepository({ root: repo, project: repo }));
    const ask = (symbol) =>
      answerQuery({
        store,
        root: repo,
        project: repo,
        query: { mode: 'usages', symbol, limit: 50 },
        refresh: false,
      });

    const text = formatGraph(await ask('readJson'), repo);
    const x = blockOf(text, 'src/x.ts');
    const y = blockOf(text, 'src/y.ts');
    check(
      'each definition lists only the calls bound to it',
      x.includes('src/x.ts:5') &&
        !x.includes('src/y.ts:5') &&
        y.includes('src/y.ts:5') &&
        !y.includes('src/x.ts:5'),
      text,
    );
    check(
      'a line grep finds and the graph does not link is shown as a text match',
      text.includes('Text matches, not linked (2):') && text.includes('README.md:1'),
      text,
    );
    check(
      'so is a use in a language read by pattern that no edge can hold',
      text.includes("tool.php:2  $parsed = array_map('readJson', $rows);"),
      text,
    );
    check(
      'a linked line is not repeated as a text match',
      occurrences(text, 'src/x.ts:5') === 1,
      text,
    );

    const member = formatGraph(await ask('render'), repo);
    check(
      'a method names its class instead of listing it as a use',
      member.includes('Member of: Widget') && member.includes('Referenced by (0):'),
      member,
    );

    const outside = mkdtempSync(join(tmpdir(), 'graph-answer-plain-'));
    const failed = formatText(unlinkedText(outside, 'readJson', [], [])).join('\n');
    check(
      'a text search that cannot run says so instead of showing nothing',
      failed.startsWith('Text matches: not searched'),
      failed,
    );
    rmSync(outside, { recursive: true, force: true });
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
}
