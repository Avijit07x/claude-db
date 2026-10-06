import type { RecallContext } from '../context.js';
import type { Observation } from '../types.js';

const PAGE = 500;

export async function eachObservation(
  ctx: RecallContext,
  filter: { project?: string },
  visit: (batch: Observation[]) => Promise<void> | void,
): Promise<number> {
  let after: number | undefined;
  let afterId: string | undefined;
  let total = 0;

  for (;;) {
    const batch = await ctx.store.list({
      ...filter,
      ...(after === undefined ? {} : { after }),
      ...(afterId === undefined ? {} : { afterId }),
      limit: PAGE,
    });
    if (batch.length === 0) return total;

    await visit(batch);
    total += batch.length;

    const last = batch[batch.length - 1];
    if (!last) return total;
    after = last.createdAt;
    afterId = last.id;
    if (batch.length < PAGE) return total;
  }
}
