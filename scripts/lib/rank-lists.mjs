import { overlapCount } from '../../dist/hooks/relevance.js';
import { PICK_POOL, recallQuery } from '../../dist/hooks/prompt-recall.js';
import { applyRecencyBoost } from '../../dist/search/rank.js';
import { meaningfulTokens } from '../../dist/search/stopwords.js';
import { isSearchable, typedPrompt } from '../../dist/util/prompt.js';

export const LIST_NAMES = ['fused', 'fusedNoRecency', 'keyword', 'keywordOverlap'];

export function searchableText(rawPrompt) {
  const text = typedPrompt(rawPrompt);
  const usable = text !== null && isSearchable(text) && meaningfulTokens(text).length > 0;
  return usable ? text : null;
}

function byOverlap(text, keyword) {
  return keyword
    .map((entry, position) => ({ entry, position, shared: overlapCount(text, entry) }))
    .sort((a, b) => b.shared - a.shared || a.position - b.position)
    .map(({ entry }) => entry);
}

export async function rankLists(ctx, { text, project, sessionId, until, shown }) {
  const { keyword, fused } = await ctx.search.candidates(
    recallQuery(text, { project, sessionId, until }),
  );
  const cut = (entries) =>
    entries
      .slice(0, PICK_POOL)
      .map((entry) => entry.id)
      .filter((id) => !shown.has(id));
  return {
    fused: cut(applyRecencyBoost(fused, until)),
    fusedNoRecency: cut(fused),
    keyword: cut(keyword),
    keywordOverlap: cut(byOverlap(text, keyword)),
  };
}
