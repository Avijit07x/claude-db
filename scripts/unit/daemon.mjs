import { runIsolated } from '../lib/isolated.mjs';

export default async function run() {
  runIsolated(new URL('./isolated/daemon-run.mjs', import.meta.url).pathname);
}
