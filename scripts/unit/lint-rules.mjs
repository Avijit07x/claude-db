import { check } from '../lib/check.mjs';
import { readsProcessEnv } from '../lib/lint-rules.mjs';

export default function run() {
  check(
    'lint fails a process.env read outside the helper',
    readsProcessEnv('src/hooks/handlers/user-prompt.ts', "const url = process.env['X'];"),
  );
  check(
    'lint fails a process.env default parameter',
    readsProcessEnv('src/util/claude-binary.ts', 'export function find(env = process.env) {'),
  );
  check(
    'lint allows process.env in the helper module',
    !readsProcessEnv('src/util/env.ts', 'return requests.getStore() ?? process.env;'),
  );
  check(
    'lint ignores a name that only looks like process.env',
    !readsProcessEnv('src/util/x.ts', 'const cleaned = myprocess.environment;'),
  );
}
