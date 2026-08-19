import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PROJECT = process.cwd();
const SLUG = PROJECT.replace(/[/.]/g, '-');
const TRANSCRIPTS = join(homedir(), '.claude', 'projects', SLUG);
const CHARS_PER_TOKEN = 4;

const tok = (chars) => Math.round(chars / CHARS_PER_TOKEN);
const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { cwd: PROJECT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    const err = error;
    return err.status === 1 ? '' : (err.stdout ?? '');
  }
}

function measureInjection() {
  let files;
  try {
    files = readdirSync(TRANSCRIPTS).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return null;
  }

  const seen = new Map();
  const sessions = new Set();

  for (const file of files) {
    sessions.add(file);
    for (const line of readFileSync(join(TRANSCRIPTS, file), 'utf8').split('\n')) {
      if (!line.includes('recalled-memory') && !line.includes('project-memory')) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const blob = JSON.stringify(entry.attachment ?? entry.message ?? {});
      for (const tag of ['recalled-memory', 'project-memory']) {
        const open = blob.indexOf(tag);
        const close = blob.indexOf(`/${tag}`);
        if (open < 0 || close <= open) continue;
        const row = seen.get(tag) ?? { n: 0, chars: 0 };
        row.n += 1;
        row.chars += close - open;
        seen.set(tag, row);
      }
    }
  }

  return { blocks: seen, sessions: sessions.size };
}

function filesTouchedBy(symbol) {
  const out = sh('git', ['grep', '-l', '-w', '-I', '--untracked', '-e', symbol]);
  return out.split('\n').filter(Boolean);
}

function readCost(files, cap = Infinity) {
  const sizes = [];
  for (const file of files) {
    try {
      sizes.push(statSync(join(PROJECT, file)).size);
    } catch {}
  }
  sizes.sort((a, b) => b - a);
  return sizes.slice(0, cap).reduce((n, size) => n + size, 0);
}

function measureLookups(symbols) {
  const rows = [];
  for (const symbol of symbols) {
    const grep = sh('git', ['grep', '-n', '-w', '-I', '--untracked', '-e', symbol]);
    if (grep.length === 0) continue;

    const explain = sh('claude-db', ['usages', '--mode', 'explain', symbol]);
    if (explain.length === 0) continue;

    const touched = filesTouchedBy(symbol);
    rows.push({
      symbol,
      grep: grep.length,
      explain: explain.length,
      files: touched.length,
      read1: readCost(touched, 1),
      read2: readCost(touched, 2),
      read: readCost(touched),
    });
  }
  return rows;
}

function measureRecall(query) {
  const search = sh('claude-db', ['search', query]);
  const log = sh('git', ['log', '--oneline', '-S', query.split(' ')[0], '--all']);
  return { search: search.length, log: log.length };
}

const SYMBOLS = [
  'isSearchable',
  'observationsFromTurns',
  'closeObservations',
  'redact',
  'flushSession',
  'refreshGraph',
  'observationId',
  'toSnippet',
  'removeGraph',
  'openWork',
];

console.log('claude-db token economics — measured, not estimated');
console.log(`(tokens approximated at ${CHARS_PER_TOKEN} chars/token)\n`);

const injection = measureInjection();
if (injection) {
  console.log('COST — context injected per session, used or not');
  console.log('-'.repeat(70));
  let totalChars = 0;
  let totalBlocks = 0;
  for (const [tag, row] of injection.blocks) {
    totalChars += row.chars;
    totalBlocks += row.n;
    console.log(
      `  ${pad(tag, 18)} ${num(row.n, 4)}x  ${num(row.chars.toLocaleString(), 9)} chars` +
        `  avg ${num(Math.round(row.chars / row.n), 5)}`,
    );
  }
  console.log('-'.repeat(70));
  console.log(
    `  ${pad('TOTAL', 18)} ${num(totalBlocks, 4)}x  ${num(totalChars.toLocaleString(), 9)} chars` +
      `  ~${tok(totalChars).toLocaleString()} tokens`,
  );
  console.log(
    `  across ${injection.sessions} sessions = ~${tok(totalChars / injection.sessions).toLocaleString()} tokens/session\n`,
  );
}

const lookups = measureLookups(SYMBOLS);
console.log('LOOKUP — one symbol question, three ways');
console.log('-'.repeat(70));
console.log(
  `  ${pad('symbol', 22)}${num('grep', 7)}${num('explain', 9)}${num('read1', 8)}${num('read2', 8)}${num('readAll', 9)}  files`,
);
console.log('-'.repeat(70));
for (const row of lookups) {
  console.log(
    `  ${pad(row.symbol, 22)}${num(row.grep, 7)}${num(row.explain, 9)}${num(row.read1, 8)}${num(row.read2, 8)}${num(row.read, 9)}  ${row.files}`,
  );
}

const sum = (key) => lookups.reduce((n, row) => n + row[key], 0);
console.log('-'.repeat(70));
console.log(
  `  ${pad('TOTAL chars', 22)}${num(sum('grep'), 7)}${num(sum('explain'), 9)}${num(sum('read1'), 8)}${num(sum('read2'), 8)}${num(sum('read'), 9)}`,
);
console.log(
  `  ${pad('TOTAL tokens', 22)}${num(tok(sum('grep')), 7)}${num(tok(sum('explain')), 9)}${num(tok(sum('read1')), 8)}${num(tok(sum('read2')), 8)}${num(tok(sum('read')), 9)}`,
);

console.log('\nVERDICT');
console.log('-'.repeat(70));
const vsGrep = sum('explain') / sum('grep');
console.log(
  `  vs grep alone (no read)     ${vsGrep.toFixed(2)}x  ${vsGrep > 1 ? 'MORE — a loss' : 'less'}`,
);
for (const [label, key] of [
  ['vs grep + 1 file read     ', 'read1'],
  ['vs grep + 2 file reads    ', 'read2'],
  ['vs grep + every file read ', 'read'],
]) {
  const ratio = (sum(key) + sum('grep')) / sum('explain');
  console.log(`  ${label} ${ratio.toFixed(2)}x  ${ratio > 1 ? 'LESS — a win' : 'MORE — a loss'}`);
}

if (injection) {
  let totalChars = 0;
  for (const [, row] of injection.blocks) totalChars += row.chars;
  const perSession = tok(totalChars / injection.sessions);
  console.log(`\n  injection costs ${perSession.toLocaleString()} tokens/session. Break-even:`);
  for (const [label, key] of [
    ['reading 1 file per lookup ', 'read1'],
    ['reading 2 files per lookup', 'read2'],
  ]) {
    const saved = tok((sum(key) + sum('grep') - sum('explain')) / lookups.length);
    const n = perSession / saved;
    console.log(
      `    ${label}  saves ${num(saved.toLocaleString(), 6)} tokens/lookup` +
        `  ->  ${n < 1 ? 'under 1' : n.toFixed(1)} lookup(s)/session`,
    );
  }
}

const recall = measureRecall('why does capture read the transcript');
console.log('\nRECALL — asking "why is it like this"');
console.log('-'.repeat(70));
console.log(
  `  claude-db search      ${num(recall.search, 7)} chars  ~${tok(recall.search)} tokens`,
);
console.log(`  git log -S (partial)  ${num(recall.log, 7)} chars  ~${tok(recall.log)} tokens`);
console.log('  (git log gives commit subjects only — the reasoning needs the diffs too)');
