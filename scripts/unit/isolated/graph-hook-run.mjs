import '../../lib/require-isolated.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { report } from '../../lib/isolated.mjs';
import { scopeToken } from '../../../dist/util/scope.js';

const dist = new URL('../../../dist/', import.meta.url).pathname;
const cli = join(dist, 'cli', 'index.js');
const grepHook = join(dist, 'hooks', 'prefer-usages.js');
const startHook = join(dist, 'hooks', 'session-start.js');
const WAIT_MS = 20_000;
const POLL_MS = 100;

mkdirSync(join(homedir(), 'app', 'src'), { recursive: true });
const repo = realpathSync(join(homedir(), 'app'));
const write = (path, text) => writeFileSync(join(repo, path), text);
write('src/a.ts', 'export function widgetFactory() {\n  return 1;\n}\n');
write('src/b.ts', "import { widgetFactory } from './a';\nexport const made = widgetFactory();\n");
write('README.md', 'Call widgetFactory to make one.\n');
const git = (...args) =>
  execFileSync('git', ['-c', 'user.email=t@e.st', '-c', 'user.name=t', ...args], {
    cwd: repo,
    stdio: 'ignore',
  });
git('init', '-q');
git('add', '.');
git('commit', '-qm', 'seed');
execFileSync(process.execPath, ['--no-warnings', cli, 'scan'], { cwd: repo, stdio: 'ignore' });

const runHook = (script, payload) =>
  execFileSync(process.execPath, ['--no-warnings', script], {
    cwd: repo,
    input: JSON.stringify({ cwd: repo, ...payload }),
    encoding: 'utf8',
  });

function grepAnswer() {
  const out = runHook(grepHook, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Grep',
    tool_input: { pattern: 'widgetFactory' },
  });
  return JSON.parse(out).hookSpecificOutput?.permissionDecisionReason ?? '';
}

const lock = join(homedir(), '.claude-memory', 'graph-refresh', `${scopeToken(repo)}.lock`);

async function lockReleased() {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    if (!existsSync(lock)) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return false;
}

const first = grepAnswer();
report(
  'the grep hook answers from the graph and adds the text match it could not link',
  first.includes('src/b.ts:2') && first.includes('README.md:1') && !first.includes('changed since'),
  first,
);

write('src/b.ts', "import { widgetFactory } from './a';\n\nexport const made = widgetFactory();\n");
const stale = grepAnswer();
report(
  'after an edit the hook says the file changed instead of passing old lines as current',
  stale.includes('1 file(s) changed since the last scan'),
  stale,
);
report('and it refreshes the graph in the background', await lockReleased());
const fresh = grepAnswer();
report(
  'the next answer shows the moved line',
  fresh.includes('src/b.ts:3') && !fresh.includes('changed since'),
  fresh,
);

write(
  'src/b.ts',
  "import { widgetFactory } from './a';\n\n\nexport const made = widgetFactory();\n",
);
runHook(startHook, { hook_event_name: 'SessionStart', source: 'startup', session_id: 's1' });
const settled = await lockReleased();
const caughtUp = grepAnswer();
report(
  'after session start the graph catches up through the background refresh',
  settled && caughtUp.includes('src/b.ts:4') && !caughtUp.includes('changed since'),
  caughtUp,
);
