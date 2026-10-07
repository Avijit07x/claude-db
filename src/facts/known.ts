import type { RecallContext } from '../context.js';
import { HANDOFF_TAG } from './handoff.js';
import { FACT_SESSION, factKey, factType, onePerKey, youScope } from './model.js';
import type { ExistingFact } from './ops.js';
import { MANUAL_SESSION } from './render.js';

const EXISTING_LIMIT = 80;

export async function existingFacts(ctx: RecallContext, project: string): Promise<ExistingFact[]> {
  const owners: [string, ExistingFact['scope']][] = [
    [project, 'project'],
    [youScope(), 'you'],
  ];
  const facts: ExistingFact[] = [];
  for (const [owner, scope] of owners) {
    const rows = await ctx.store.list({
      project: owner,
      sessionId: FACT_SESSION,
      newest: true,
      limit: EXISTING_LIMIT,
    });
    for (const obs of onePerKey(rows.filter((row) => row.status !== 'replaced'))) {
      const key = factKey(obs);
      const type = factType(obs);
      if (obs.status === 'replaced' || !key || !type) continue;
      facts.push({ key, type, scope, text: obs.title });
    }
  }
  return facts;
}

export async function notedByUser(ctx: RecallContext, project: string): Promise<string[]> {
  const rows = await ctx.store.list({
    project,
    sessionId: MANUAL_SESSION,
    newest: true,
    limit: EXISTING_LIMIT,
  });
  return rows
    .filter((row) => row.status !== 'replaced' && !row.tags.includes(HANDOFF_TAG))
    .map((row) => row.title);
}
