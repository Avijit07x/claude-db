import { cpus } from 'node:os';

const RECALL_TOLERANCE = 0.005;
const EXTRA_TOLERANCE = 0.005;
const SLOWER_LIMIT = 1.2;
const TIME_FLOOR_MS = 50;
const TIMES = ['scanMs', 'refreshMs', 'hookMs'];

const rate = (part, whole) => (whole === 0 ? 1 : part / whole);
const percent = (part, whole) => `${(rate(part, whole) * 100).toFixed(1)}%`;

export const machine = () =>
  `${process.platform}-${process.arch}-${cpus()[0]?.model ?? 'cpu'}-${cpus().length}`;

function bucketCells(buckets) {
  return Object.entries(buckets).map(
    ([bucket, tally]) =>
      `${bucket} ${tally.linked}/${tally.total} (${percent(tally.linked, tally.total)}, ` +
      `with text ${percent(tally.covered, tally.total)})`,
  );
}

const extraCell = (extra) =>
  extra ? `extra ${extra.extra}/${extra.checked} (${percent(extra.extra, extra.checked)})` : '';

const timeCell = (result) =>
  TIMES.map((key) => `${key.replace('Ms', '')} ${result[key] ?? '-'} ms`).join(', ');

export function printResult(result) {
  if (result.skipped) {
    console.log(`${result.name} [${result.language}]  skipped: ${result.skipped}`);
    return;
  }
  console.log(`${result.name} [${result.language}]  ${result.files} files, ${result.note}`);
  for (const cell of bucketCells(result.buckets)) console.log(`  ${cell}`);
  const extra = extraCell(result.extra);
  if (extra) console.log(`  ${extra}`);
  console.log(`  ${timeCell(result)}`);
}

export function printMissed(result, limit) {
  for (const miss of (result.missed ?? []).slice(0, limit)) {
    console.log(`    MISSED ${miss.bucket} ${miss.file}:${miss.line} ${miss.name}  ${miss.text}`);
  }
}

function accuracyProblems(base, now) {
  const problems = [];
  for (const [bucket, before] of Object.entries(base.buckets ?? {})) {
    const after = now.buckets?.[bucket];
    if (!after) {
      problems.push(`${now.name} ${bucket}: no longer measured`);
      continue;
    }
    for (const field of ['linked', 'covered']) {
      const drop = rate(before[field], before.total) - rate(after[field], after.total);
      if (drop > RECALL_TOLERANCE) {
        problems.push(`${now.name} ${bucket}: ${field} fell by ${(drop * 100).toFixed(2)} points`);
      }
    }
  }
  if (base.extra && now.extra) {
    const rise =
      rate(now.extra.extra, now.extra.checked) - rate(base.extra.extra, base.extra.checked);
    if (rise > EXTRA_TOLERANCE) {
      problems.push(`${now.name}: wrong edges rose by ${(rise * 100).toFixed(2)} points`);
    }
  }
  return problems;
}

function speedProblems(base, now) {
  const problems = [];
  for (const key of TIMES) {
    const before = base[key];
    const after = now[key];
    if (before == null || after == null) continue;
    if (after > before * SLOWER_LIMIT && after - before > TIME_FLOOR_MS) {
      problems.push(`${now.name}: ${key} went from ${before} to ${after}`);
    }
  }
  return problems;
}

export function regressions(baseline, results) {
  const sameMachine = baseline.machine === machine();
  const problems = [];
  for (const now of results) {
    const base = baseline.results.find((entry) => entry.name === now.name);
    if (!base || base.skipped) continue;
    if (now.skipped) {
      problems.push(`${now.name}: not measured (${now.skipped})`);
      continue;
    }
    problems.push(...accuracyProblems(base, now));
    if (sameMachine) problems.push(...speedProblems(base, now));
  }
  return { problems, sameMachine };
}
