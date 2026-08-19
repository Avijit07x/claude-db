import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT = process.cwd();
const CHARS_PER_TOKEN = 4;
const INJECTION_PER_PROMPT = 180;

const tok = (chars) => Math.round(chars / CHARS_PER_TOKEN);
const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);
const rule = (n = 74) => console.log('-'.repeat(n));

const CODE_ONLY = [':!*.md', ':!docs/'];

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { cwd: PROJECT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    return error.status === 1 ? '' : (error.stdout ?? '');
  }
}

function definingFile(symbol) {
  const explain = sh('claude-db', ['usages', '--mode', 'explain', symbol]);
  const match = /Source: (\S+):/.exec(explain);
  return match?.[1] ?? null;
}

function sizeOf(file) {
  try {
    return statSync(join(PROJECT, file)).size;
  } catch {
    return 0;
  }
}

const SYMBOLS = [
  'isSearchable',
  'observationsFromTurns',
  'closeObservations',
  'flushSession',
  'refreshGraph',
  'observationId',
  'toSnippet',
  'openWork',
];

const QUESTIONS = [
  ['why does capture read the transcript', 'transcript'],
  ['how does work get closed when a commit lands', 'closeLandedWork'],
  ['what changed about find_usages', 'find_usages'],
];

console.log('claude-db — the same question, answered with and without it');
console.log(`(tokens approximated at ${CHARS_PER_TOKEN} chars/token)`);
console.log('(grep excludes prose so both sides see the same code)\n');

console.log('A. "who uses this symbol, and how?"');
rule();
console.log(
  `  ${pad('symbol', 22)}${num('WITH', 8)}${num('grep', 8)}${num('+read', 8)}${num('WITHOUT', 9)}`,
);
rule();

let withA = 0;
let withoutA = 0;
for (const symbol of SYMBOLS) {
  const explain = sh('claude-db', ['usages', '--mode', 'explain', symbol]).length;
  if (explain === 0) continue;
  const grep = sh('git', [
    'grep',
    '-n',
    '-w',
    '-I',
    '--untracked',
    '-e',
    symbol,
    '--',
    ...CODE_ONLY,
  ]).length;
  const read = sizeOf(definingFile(symbol) ?? '');
  withA += explain;
  withoutA += grep + read;
  console.log(
    `  ${pad(symbol, 22)}${num(explain, 8)}${num(grep, 8)}${num(read, 8)}${num(grep + read, 9)}`,
  );
}
rule();
console.log(
  `  ${pad('TOTAL chars', 22)}${num(withA, 8)}${num('', 8)}${num('', 8)}${num(withoutA, 9)}`,
);
console.log(
  `  ${pad('TOTAL tokens', 22)}${num(tok(withA), 8)}${num('', 8)}${num('', 8)}${num(tok(withoutA), 9)}`,
);
console.log(
  `  ${pad('', 22)}${num('', 8)}${num('', 8)}${num('', 8)}${num(`${(withoutA / withA).toFixed(1)}x`, 9)}`,
);

console.log('\nB. "why is it like this?"');
rule();
console.log(`  ${pad('question', 42)}${num('WITH', 8)}${num('WITHOUT', 9)}`);
rule();

let withB = 0;
let withoutB = 0;
for (const [question, term] of QUESTIONS) {
  const search = sh('claude-db', ['search', question]).length;
  const log = sh('git', ['log', '--oneline', '-S', term, '--all']);
  const top = log.split('\n')[0]?.split(' ')[0];
  const diff = top ? sh('git', ['show', '--stat', top]).length : 0;
  const without = log.length + diff;
  withB += search;
  withoutB += without;
  console.log(`  ${pad(question.slice(0, 40), 42)}${num(search, 8)}${num(without, 9)}`);
}
rule();
console.log(`  ${pad('TOTAL chars', 42)}${num(withB, 8)}${num(withoutB, 9)}`);
console.log(`  ${pad('TOTAL tokens', 42)}${num(tok(withB), 8)}${num(tok(withoutB), 9)}`);
console.log('  note: WITHOUT here is commit subjects plus one --stat. It locates the change;');
console.log('  it does not explain the reasoning, so the two are not equivalent answers.');

console.log('\nC. what it takes to come out ahead');
rule();

const perLookupWith = tok(withA / SYMBOLS.length);
const perLookupWithout = tok(withoutA / SYMBOLS.length);
const refund = perLookupWithout - perLookupWith;
const ratio = INJECTION_PER_PROMPT / refund;

console.log(`  every prompt costs   ${num(INJECTION_PER_PROMPT, 6)} tokens of recall`);
console.log(
  `  every lookup refunds ${num(refund, 6)} tokens` +
    `   (${perLookupWithout} by hand - ${perLookupWith} with)`,
);
console.log(
  `\n  so one lookup pays for ${(1 / ratio).toFixed(1)} prompts of recall` +
    ` — break even at 1 lookup per ${(1 / ratio).toFixed(0)} prompts`,
);
console.log();
console.log(
  `  ${pad('a session of', 16)}${num('recall costs', 14)}${num('lookups to break even', 23)}`,
);
rule();
for (const prompts of [1, 5, 10, 20, 60]) {
  const cost = INJECTION_PER_PROMPT * prompts;
  console.log(
    `  ${pad(`${prompts} prompts`, 16)}${num(cost.toLocaleString(), 14)}` +
      `${num((cost / refund).toFixed(1), 23)}`,
  );
}
rule();
console.log('  session length is measured, not assumed: see bench-tokens for the');
console.log('  distribution across this project (median 1 prompt, mean 6.9).');
