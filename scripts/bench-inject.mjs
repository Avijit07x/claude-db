import { silenceSqliteWarning } from '../dist/util/warnings.js';
import { createContext } from '../dist/context.js';
import { replay, replayablePrompts } from './lib/replay.mjs';
import { resolveProject } from '../dist/util/project.js';
import { JUDGE_PASSES, agreement, judgePass } from './lib/judge.mjs';
import { compareRank as compareRankReport } from './lib/rank-compare.mjs';
import { headlessPicker } from '../dist/pick/run.js';

silenceSqliteWarning();

const GOAL_PROMPTS = 0.4;
const GOAL_SAME_CHAT = 0;
const GOAL_USEFUL = 0.8;
const CHARS_PER_TOKEN = 4;

const args = process.argv.slice(2);
const VALUED = new Set(['--last', '--show', '--judge-model', '--labels']);

function option(name, fallback) {
  const index = args.indexOf(name);
  const value = Number(args[index + 1]);
  return index >= 0 && Number.isInteger(value) && value > 0 ? value : fallback;
}

const positional = args.filter((arg, i) => !arg.startsWith('--') && !VALUED.has(args[i - 1]));
const project = resolveProject(positional[0]);
const last = option('--last', 100);
const show = option('--show', 0);
const picking = !args.includes('--no-pick');
const judging = args.includes('--judge');
const compareRank = args.includes('--compare-rank');
const labels = args.includes('--labels') ? args[args.indexOf('--labels') + 1] : null;
const judgeModel = args.includes('--judge-model')
  ? args[args.indexOf('--judge-model') + 1]
  : 'sonnet';

const percent = (part, whole) => (whole === 0 ? '0%' : `${Math.round((part / whole) * 100)}%`);
const line = (label, value, goal) =>
  console.log(`  ${label.padEnd(26)} ${value.padEnd(20)} ${goal ?? ''}`);

if (compareRank && !judging && !labels) {
  console.error('--compare-rank needs --judge or --labels <file>.');
  process.exit(1);
}

const prompts = replayablePrompts(project, last);
if (prompts.length === 0) {
  console.error(`No transcripts found for ${project}.`);
  process.exit(1);
}

async function memoryReport(ctx, result) {
  const { rows, shownWith, samples, answered, outcomes, blockChars, injectedChars } = result;
  const found = await ctx.search.getObservations([
    ...new Set(shownWith.flatMap((group) => group.candidates)),
  ]);
  const observations = new Map(found.map((obs) => [obs.id, obs]));
  const sameChat = rows.filter((row) => observations.get(row.id)?.sessionId === row.sessionId);
  const chats = new Set(prompts.map((item) => item.sessionId)).size;

  console.log(`Memory check  ${project}`);
  console.log(`  replayed ${prompts.length} prompts from ${chats} chats, in time order\n`);
  line(
    'prompts that got memory',
    `${answered} of ${prompts.length} (${percent(answered, prompts.length)})`,
    `goal: under ${percent(GOAL_PROMPTS, 1)}`,
  );
  line(
    'rows from the same chat',
    `${sameChat.length} of ${rows.length} (${percent(sameChat.length, rows.length)})`,
    `goal: ${percent(GOAL_SAME_CHAT, 1)}`,
  );
  line(
    'Haiku picks',
    picking
      ? `${outcomes.picked} picked, ${outcomes.passed} passed, ${outcomes.failed} failed`
      : 'off (--no-pick)',
    picking ? `asked on ${outcomes.picked + outcomes.passed + outcomes.failed} prompts` : '',
  );

  if (!judging) {
    line('rows judged useful', 'run with --judge', `goal: ${GOAL_USEFUL * 10} in 10`);
  } else if (rows.length === 0) {
    line('rows judged useful', 'nothing to judge', `goal: ${GOAL_USEFUL * 10} in 10`);
  } else {
    const groups = shownWith.map((group, index) => ({ ...group, key: String(index) }));
    const shownKeys = groups.flatMap((group) => group.shown.map((id) => `${group.key}\0${id}`));
    const passes = await Promise.all(
      Array.from({ length: JUDGE_PASSES }, () => judgePass(groups, observations, judgeModel)),
    );
    const rates = passes
      .map((verdicts) =>
        shownKeys.filter((key) => verdicts.has(key)).map((key) => verdicts.get(key)),
      )
      .filter((judged) => judged.length > 0)
      .map((judged) => judged.filter(Boolean).length / judged.length);
    const low = percent(Math.min(...rates), 1);
    const high = percent(Math.max(...rates), 1);
    line(
      'rows judged useful',
      rates.length === 0 ? 'judge unavailable' : low === high ? low : `${low} to ${high}`,
      `goal: ${GOAL_USEFUL * 10} in 10 (${judgeModel})`,
    );
    const kappa = passes.length === 2 ? agreement(passes[0], passes[1], shownKeys) : null;
    if (kappa !== null) {
      line(
        'judge agreement',
        `kappa ${kappa.toFixed(2)}`,
        'two blind passes; under 0.6 is too noisy',
      );
    }
  }

  const average = answered === 0 ? 0 : Math.round(blockChars / answered / CHARS_PER_TOKEN);
  line('average block', `~${average} tokens`);
  line(
    'recall per prompt',
    `~${Math.round(injectedChars / prompts.length / CHARS_PER_TOKEN)} tokens`,
    'every prompt, including the ones that got nothing',
  );

  for (const sample of samples) {
    console.log(`\n> ${sample.prompt.replace(/\s+/g, ' ').slice(0, 120)}`);
    console.log(sample.block);
  }
}

const ctx = await createContext();
try {
  const result = await replay(ctx, project, prompts, {
    show,
    picker: picking && !compareRank ? headlessPicker(ctx.config) : null,
  });
  if (compareRank) {
    await compareRankReport(ctx, project, prompts, result.shownBefore, { labels, judgeModel });
  } else {
    await memoryReport(ctx, result);
  }
} finally {
  await ctx.close();
}
