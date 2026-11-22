import rows from './contract-rows.mjs';
import lists from './contract-lists.mjs';
import removal from './contract-removal.mjs';
import search from './contract-search.mjs';

export default async function run(ctx, check) {
  await rows(ctx, check);
  await lists(ctx, check);
  await removal(ctx, check);
  await search(ctx, check);
}
