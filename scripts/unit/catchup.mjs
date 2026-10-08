import { runIsolated } from '../lib/isolated.mjs';

export default async function run() {
  runIsolated(new URL('./isolated/catchup-run.mjs', import.meta.url).pathname);
  runIsolated(new URL('./isolated/last-chat-run.mjs', import.meta.url).pathname);
  runIsolated(new URL('./isolated/chat-chain-run.mjs', import.meta.url).pathname);
}
