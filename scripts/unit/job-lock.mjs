import { runIsolated } from '../lib/isolated.mjs';

export default async function run() {
  runIsolated(new URL('./isolated/job-lock-run.mjs', import.meta.url).pathname);
}
