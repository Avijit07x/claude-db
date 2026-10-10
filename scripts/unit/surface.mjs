import { runIsolated } from '../lib/isolated.mjs';

export default async function run() {
  runIsolated(new URL('./isolated/mcp-run.mjs', import.meta.url).pathname);
  runIsolated(new URL('./isolated/session-end-run.mjs', import.meta.url).pathname);
  runIsolated(new URL('./isolated/cli-run.mjs', import.meta.url).pathname);
  runIsolated(new URL('./isolated/redact-run.mjs', import.meta.url).pathname);
  runIsolated(new URL('./isolated/graph-hook-run.mjs', import.meta.url).pathname);
  runIsolated(new URL('./isolated/background-run.mjs', import.meta.url).pathname);
}
