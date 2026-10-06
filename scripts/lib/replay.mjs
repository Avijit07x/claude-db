import { basename } from 'node:path';
import { readTranscript, transcriptsFor } from '../../dist/capture/index.js';
import { promptCandidates, strictRecall, withCost } from '../../dist/hooks/prompt-recall.js';
import { pickMemories } from '../../dist/pick/run.js';

export function replayablePrompts(project, last) {
  const prompts = new Map();
  for (const path of transcriptsFor(project)) {
    const sessionId = basename(path, '.jsonl');
    let previousReply = '';
    for (const turn of readTranscript(path).turns) {
      const key = `${turn.timestamp}\0${turn.prompt}`;
      if (prompts.has(key)) continue;
      prompts.set(key, {
        sessionId,
        prompt: turn.prompt,
        timestamp: turn.timestamp,
        previousReply,
      });
      previousReply = turn.reasoning;
    }
  }
  return [...prompts.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-last);
}

async function recallFor(ctx, project, item, shown, picker) {
  const candidates = await promptCandidates(ctx, {
    prompt: item.prompt,
    project,
    sessionId: item.sessionId,
    shown,
    until: item.timestamp - 1,
  });
  if (!candidates) return { recall: null, outcome: 'none', candidates: [] };
  const ids = candidates.entries.map((entry) => entry.id);
  if (picker) {
    const outcome = await pickMemories(
      ctx,
      {
        prompt: candidates.prompt,
        previousReply: item.previousReply,
        ids,
      },
      picker,
    );
    if (outcome.kind === 'picked') {
      return {
        recall: { block: outcome.block, ids: outcome.ids },
        outcome: 'picked',
        candidates: ids,
      };
    }
    if (outcome.kind === 'none') return { recall: null, outcome: 'passed', candidates: ids };
  }
  const recall = await strictRecall(ctx, candidates);
  return { recall, outcome: picker ? 'failed' : 'words', candidates: ids };
}

export async function replay(
  ctx,
  project,
  prompts,
  { show = 0, picker = null, parallel = 6 } = {},
) {
  const chats = new Map();
  for (const item of prompts)
    chats.set(item.sessionId, [...(chats.get(item.sessionId) ?? []), item]);

  const results = new Map();
  const queue = [...chats.values()];
  const workers = Array.from({ length: picker ? parallel : 1 }, async () => {
    for (let chat = queue.shift(); chat; chat = queue.shift()) {
      const shown = new Set();
      for (const item of chat) {
        const result = await recallFor(ctx, project, item, shown, picker);
        for (const id of result.recall?.ids ?? []) shown.add(id);
        results.set(item, result);
      }
    }
  });
  await Promise.all(workers);

  const rows = [];
  const shownWith = [];
  const samples = [];
  let answered = 0;
  const outcomes = { picked: 0, passed: 0, failed: 0, words: 0, none: 0 };
  let blockChars = 0;
  let injectedChars = 0;
  for (const item of prompts) {
    const { recall, outcome, candidates } = results.get(item);
    outcomes[outcome] += 1;
    if (!recall) continue;
    shownWith.push({ ...item, candidates, shown: recall.ids });
    answered += 1;
    blockChars += recall.block.length;
    injectedChars += withCost(recall.block).length;
    for (const id of recall.ids) {
      rows.push({
        id,
        prompt: item.prompt,
        previousReply: item.previousReply,
        sessionId: item.sessionId,
      });
    }
    if (samples.length < show) samples.push({ prompt: item.prompt, block: recall.block });
  }
  return { rows, shownWith, samples, answered, outcomes, blockChars, injectedChars };
}
