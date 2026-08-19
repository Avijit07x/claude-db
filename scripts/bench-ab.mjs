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

console.log('\nC. per session — a fixed cost, refunded per lookup');
rule();

const perLookupWith = tok(withA / SYMBOLS.length);
const perLookupWithout = tok(withoutA / SYMBOLS.length);
const PROMPTS_PER_SESSION = 20;
const overhead = INJECTION_PER_PROMPT * PROMPTS_PER_SESSION;
const refund = perLookupWithout - perLookupWith;
const breakEven = overhead / refund;

console.log(
  `  every session pays   ${num(overhead.toLocaleString(), 7)} tokens` +
    `   (${INJECTION_PER_PROMPT}/prompt x ${PROMPTS_PER_SESSION} prompts)`,
);
console.log(
  `  every lookup refunds ${num(refund.toLocaleString(), 7)} tokens` +
    `   (${perLookupWithout} without - ${perLookupWith} with)`,
);
console.log(`  so it pays for itself at ${breakEven.toFixed(0)} lookups in a session`);
console.log();
console.log(
  `  ${pad('lookups', 10)}${num('claude-db', 11)}${num('plain grep', 12)}${num('you save', 11)}`,
);
rule();

for (const n of [0, 2, 5, 10, 20]) {
  const w = overhead + perLookupWith * n;
  const o = perLookupWithout * n;
  const delta = o - w;
  console.log(
    `  ${pad(n, 10)}${num(w.toLocaleString(), 11)}${num(o.toLocaleString(), 12)}` +
      `${num(`${delta >= 0 ? '+' : ''}${delta.toLocaleString()}`, 11)}`,
  );
}
rule();
console.log('  negative = you paid more than you got back that session');
