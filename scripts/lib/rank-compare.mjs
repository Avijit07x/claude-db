import { readFileSync } from 'node:fs';
import { JUDGE_PASSES, agreement, judgePass } from './judge.mjs';
import { LIST_NAMES, rankLists, searchableText } from './rank-lists.mjs';
import { bootstrap, decide, scoreList, summary } from './rank-stats.mjs';

const LABELS = {
  fused: 'fused (today)',
  fusedNoRecency: 'fused, no recency',
  keyword: 'keyword only',
  keywordOverlap: 'keyword + shared words',
};

export async function buildCases(ctx, project, prompts, shownBefore) {
  const cases = [];
  for (const [index, item] of prompts.entries()) {
    const text = searchableText(item.prompt);
    if (text === null) continue;
    const lists = await rankLists(ctx, {
      text,
      project,
      sessionId: item.sessionId,
      until: item.timestamp - 1,
      shown: shownBefore[index],
    });
    const union = [...new Set(LIST_NAMES.flatMap((name) => lists[name]))];
    if (union.length > 0) cases.push({ key: String(index), item, lists, union });
  }
  return cases;
}

function usefulFromLabels(path) {
  const labels = JSON.parse(readFileSync(path, 'utf8'));
  const useful = new Map(Object.entries(labels).map(([key, ids]) => [key, new Set(ids)]));
  return { useful, kappa: null };
}

async function usefulFromJudge(ctx, cases, judgeModel) {
  const groups = cases.map(({ key, item, union }) => ({
    key,
    prompt: item.prompt,
    previousReply: item.previousReply,
    candidates: union,
  }));
  const found = await ctx.search.getObservations([...new Set(groups.flatMap((g) => g.candidates))]);
  const observations = new Map(found.map((obs) => [obs.id, obs]));
  const passes = await Promise.all(
    Array.from({ length: JUDGE_PASSES }, () => judgePass(groups, observations, judgeModel)),
  );
  const keys = groups.flatMap((g) => g.candidates.map((id) => `${g.key}\0${id}`));
  const agreed = (g) =>
    g.candidates.filter((id) => passes.every((verdicts) => verdicts.get(`${g.key}\0${id}`)));
  const useful = new Map(groups.map((g) => [g.key, new Set(agreed(g))]));
  return { useful, kappa: agreement(passes[0], passes[1], keys) };
}

function scoreCases(cases, useful) {
  return cases.map(({ key, lists }) => {
    const mine = useful.get(key) ?? new Set();
    return Object.fromEntries(LIST_NAMES.map((name) => [name, scoreList(lists[name], mine)]));
  });
}

const percent = (value) => `${(value * 100).toFixed(0)}%`;
const fixed = (value) => value.toFixed(2);

function cell(found, show) {
  if (found.point === null) return 'n/a';
  const [low, high] = found.range;
  return `${show(found.point)} [${show(low)}, ${show(high)}]`;
}

function signed(found, scale, unit) {
  if (found.point === null) return 'n/a';
  const [low, high] = found.range.map((value) => value * scale);
  const sign = (value) => (value >= 0 ? '+' : '') + value.toFixed(unit);
  return `${sign(found.point * scale)} [${sign(low)}, ${sign(high)}]`;
}

function renderTable(perPrompt, runs) {
  const rows = LIST_NAMES.map((name) => {
    const [supply, precision, auc] = ['supply', 'precision', 'auc'].map((metric) =>
      summary(perPrompt, runs, name, metric),
    );
    return [LABELS[name], cell(supply, percent), cell(precision, fixed), cell(auc, fixed)];
  });
  const head = ['list', 'supply@10', 'precision@3', 'AUC'];
  const table = [head, ...rows];
  const widths = head.map((_, i) => Math.max(...table.map((row) => row[i].length)));
  return table.map((row) =>
    row
      .map((text, i) => text.padEnd(widths[i]))
      .join('  ')
      .trimEnd(),
  );
}

function renderVerdict(perPrompt, runs) {
  const verdict = decide(perPrompt, runs);
  const vectors = verdict.keepVectors ? 'KEEP' : 'REMOVE';
  const recency = verdict.keepRecency ? 'KEEP' : 'DROP';
  return [
    `Verdict: vectors ${vectors} (fused minus keyword+words: supply ${signed(verdict.supply, 100, 1)} pts,`,
    `AUC ${signed(verdict.auc, 1, 2)}); recency ${recency} (no-recency minus fused: AUC ${signed(verdict.recency, 1, 2)}).`,
  ].join(' ');
}

export async function compareRank(ctx, project, prompts, shownBefore, options) {
  const cases = await buildCases(ctx, project, prompts, shownBefore);
  if (cases.length === 0) return console.log('Rank check: no prompt had any candidate note.');
  const { useful, kappa } = options.labels
    ? usefulFromLabels(options.labels)
    : await usefulFromJudge(ctx, cases, options.judgeModel);
  const perPrompt = scoreCases(cases, useful);
  const runs = bootstrap(perPrompt, LIST_NAMES);
  const judged = options.labels
    ? 'labels file'
    : `${options.judgeModel}, kappa ${kappa?.toFixed(2) ?? 'n/a'}`;
  console.log(`Rank check  ${project}`);
  console.log(
    `  ${cases.length} of ${prompts.length} prompts had candidates (${judged}); 95% intervals, paired bootstrap\n`,
  );
  for (const row of renderTable(perPrompt, runs)) console.log(`  ${row}`);
  console.log(`\n${renderVerdict(perPrompt, runs)}`);
}
