const TOP = 3;
const RESAMPLES = 2000;
const SEED = 20240611;
const LOW = 0.025;
const HIGH = 0.975;
const SUPPLY_GAIN = 0.05;
const AUC_GAIN = 0.03;
const UINT32 = 4294967296;

export function scoreList(ids, useful) {
  const marks = ids.map((id) => useful.has(id));
  const hits = marks.filter(Boolean).length;
  let wins = 0;
  let usefulAbove = 0;
  for (const mark of marks) {
    if (mark) usefulAbove += 1;
    else wins += usefulAbove;
  }
  return {
    hit: hits > 0 ? 1 : 0,
    top: marks.slice(0, TOP).filter(Boolean).length / TOP,
    wins,
    pairs: hits * (marks.length - hits),
  };
}

export function metrics(scores) {
  const total = (field) => scores.reduce((sum, score) => sum + score[field], 0);
  const pairs = total('pairs');
  return {
    supply: total('hit') / scores.length,
    precision: total('top') / scores.length,
    auc: pairs === 0 ? null : total('wins') / pairs,
  };
}

function random(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / UINT32;
  };
}

export function bootstrap(perPrompt, names) {
  const draw = random(SEED);
  const runs = [];
  for (let run = 0; run < RESAMPLES; run++) {
    const sample = perPrompt.map(() => perPrompt[Math.floor(draw() * perPrompt.length)]);
    runs.push(
      Object.fromEntries(names.map((name) => [name, metrics(sample.map((row) => row[name]))])),
    );
  }
  return runs;
}

function interval(values) {
  const sorted = values.filter((value) => value !== null).sort((a, b) => a - b);
  if (sorted.length === 0) return [null, null];
  const at = (share) => sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
  return [at(LOW), at(HIGH)];
}

function difference(first, second) {
  return first === null || second === null ? null : first - second;
}

export function summary(perPrompt, runs, name, metric) {
  return {
    point: metrics(perPrompt.map((row) => row[name]))[metric],
    range: interval(runs.map((run) => run[name][metric])),
  };
}

export function gain(perPrompt, runs, [ahead, behind], metric) {
  const point = difference(
    metrics(perPrompt.map((row) => row[ahead]))[metric],
    metrics(perPrompt.map((row) => row[behind]))[metric],
  );
  const range = interval(runs.map((run) => difference(run[ahead][metric], run[behind][metric])));
  return { point, range };
}

const clearlyAbove = (found, floor) =>
  found.point !== null && found.point >= floor && found.range[0] !== null && found.range[0] > 0;

export function decide(perPrompt, runs) {
  const pair = ['fused', 'keywordOverlap'];
  const supply = gain(perPrompt, runs, pair, 'supply');
  const auc = gain(perPrompt, runs, pair, 'auc');
  const recency = gain(perPrompt, runs, ['fusedNoRecency', 'fused'], 'auc');
  return {
    supply,
    auc,
    recency,
    keepVectors: clearlyAbove(supply, SUPPLY_GAIN) && clearlyAbove(auc, AUC_GAIN),
    keepRecency: !clearlyAbove(recency, 0),
  };
}
