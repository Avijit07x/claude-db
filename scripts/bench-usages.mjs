import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { machine, printMissed, printResult, regressions } from './bench-usages/report.mjs';

const HERE = fileURLToPath(new URL('./bench-usages/', import.meta.url));
const CORPUS = join(HERE, 'corpus.json');
const BASELINE = join(HERE, 'baseline.json');
const CHILD = join(HERE, 'child.mjs');
const DEFAULT_RUNS = 3;
const MISSED_SHOWN = 15;
const OUTPUT_LIMIT = 1 << 28;
const ERROR_TAIL = 3;

function options(argv) {
  const value = (flag) => {
    const at = argv.indexOf(flag);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  return {
    only: value('--only')?.split(',') ?? [],
    dir: value('--dir') ?? process.env.CLAUDE_DB_BENCH_DIR ?? join(tmpdir(), 'claude-db-bench'),
    runs: Number(value('--runs') ?? DEFAULT_RUNS),
    out: value('--out'),
    speed: !argv.includes('--no-speed'),
    check: argv.includes('--check'),
    write: argv.includes('--write-baseline'),
    verbose: argv.includes('--verbose'),
  };
}

const selected = (entry, only) =>
  only.length === 0 || only.includes(entry.name) || only.includes(entry.language);

function errorTail(error) {
  const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : '';
  return (stderr || error.message).split('\n').slice(-ERROR_TAIL).join(' | ');
}

function measureInChild(entry, settings) {
  const cacheDir = mkdtempSync(join(tmpdir(), 'bench-graph-cache-'));
  try {
    const output = execFileSync(process.execPath, [CHILD, JSON.stringify({ entry, settings })], {
      encoding: 'utf8',
      maxBuffer: OUTPUT_LIMIT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDE_DB_GRAPH_CACHE: cacheDir },
    });
    return JSON.parse(output.trim().split('\n').at(-1));
  } catch (error) {
    return { name: entry.name, language: entry.language, skipped: errorTail(error) };
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

const forBaseline = ({ missed: _missed, ...result }) => result;

const withoutTimes = (result) => ({ ...result, scanMs: null, refreshMs: null, hookMs: null });

function readBaseline() {
  return existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null;
}

function mergedResults(kept, order) {
  const previous = readBaseline();
  const sameMachine = previous?.machine === machine();
  const merged = new Map(
    (previous?.results ?? []).map((result) => [
      result.name,
      sameMachine ? result : withoutTimes(result),
    ]),
  );
  for (const result of kept) merged.set(result.name, result);
  return order.map((name) => merged.get(name)).filter(Boolean);
}

function saveToBaseline(result, order) {
  const baseline = {
    machine: machine(),
    date: new Date().toISOString().slice(0, 10),
    results: mergedResults([forBaseline(result)], order),
  };
  writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
}

function checkAgainst(baseline, results) {
  if (!baseline) {
    console.log(`\nNo baseline at ${BASELINE}. Run with --write-baseline first.`);
    return 1;
  }
  const { problems, sameMachine } = regressions(baseline, results);
  if (!sameMachine) console.log('\nSpeed is not gated: the baseline comes from another machine.');
  for (const problem of problems) console.log(`REGRESSION  ${problem}`);
  console.log(problems.length === 0 ? '\nNo regression against the baseline.' : '');
  return problems.length === 0 ? 0 : 1;
}

function main() {
  const settings = options(process.argv.slice(2));
  mkdirSync(settings.dir, { recursive: true });
  const corpus = JSON.parse(readFileSync(CORPUS, 'utf8')).repositories;
  const order = corpus.map((entry) => entry.name);
  const baseline = settings.check ? readBaseline() : null;
  const results = [];
  for (const entry of corpus.filter((item) => selected(item, settings.only))) {
    const result = measureInChild(entry, settings);
    printResult(result);
    if (settings.verbose) printMissed(result, MISSED_SHOWN);
    if (settings.write) saveToBaseline(result, order);
    results.push(result);
  }
  if (settings.out) {
    writeFileSync(settings.out, `${JSON.stringify(results.map(forBaseline), null, 2)}\n`);
  }
  if (settings.write) console.log(`\nBaseline written to ${BASELINE}`);
  process.exitCode = settings.check ? checkAgainst(baseline, results) : 0;
}

main();
