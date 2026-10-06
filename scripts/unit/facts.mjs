import { runIsolated } from '../lib/isolated.mjs';

export default async function run() {
  runIsolated(new URL('./isolated/distill-run.mjs', import.meta.url).pathname);
  runIsolated(new URL('./isolated/facts-run.mjs', import.meta.url).pathname);
}
