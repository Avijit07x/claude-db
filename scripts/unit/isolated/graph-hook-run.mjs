import '../../lib/require-isolated.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { report } from '../../lib/isolated.mjs';
import { createContext } from '../../../dist/context.js';
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

const runHook = (script, payload, env = {}) =>
  execFileSync(process.execPath, ['--no-warnings', script], {
    cwd: repo,
    env: { ...process.env, ...env },
    input: JSON.stringify({ cwd: repo, ...payload }),
    encoding: 'utf8',
  });

const grepPayload = {
  hook_event_name: 'PreToolUse',
  tool_name: 'Grep',
  tool_input: { pattern: 'widgetFactory' },
};

const output = (out) => (out ? JSON.parse(out).hookSpecificOutput : {});

const grepAnswer = () => output(runHook(grepHook, grepPayload)).additionalContext ?? '';

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

const blocked = output(runHook(grepHook, grepPayload, { CLAUDE_DB_USAGES_HOOK: 'deny' }));
report(
  'CLAUDE_DB_USAGES_HOOK=deny still blocks the grep and shows the answer',
  blocked.permissionDecision === 'deny' && blocked.permissionDecisionReason.includes('src/b.ts'),
  JSON.stringify(blocked),
);

const bash = (command) => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command },
});
const grepTool = (input) => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Grep',
  tool_input: { pattern: 'widgetFactory', ...input },
});

const QUIET = [
  bash('grep -rn widgetFactory README.md'),
  bash('grep -c widgetFactory src/a.ts'),
  bash('grep -rn widgetFactory src | wc -l'),
  bash('grep -rn widgetFactory /tmp'),
  bash('grep -n widgetFactory /var/log/app.log'),
  bash('git grep -n widgetFactory HEAD~1'),
  grepTool({ output_mode: 'count' }),
  grepTool({ path: 'README.md' }),
  grepTool({ path: '/tmp' }),
];
const ANSWERED = [
  bash('grep -rn widgetFactory src'),
  bash('grep -rln widgetFactory .'),
  grepTool({}),
  grepTool({ path: 'src', output_mode: 'files_with_matches' }),
];
for (const [name, env] of [
  ['default', {}],
  ['deny', { CLAUDE_DB_USAGES_HOOK: 'deny' }],
]) {
  for (const payload of QUIET) {
    const out = runHook(grepHook, payload, env);
    report(`${name}: quiet for ${JSON.stringify(payload.tool_input)}`, out === '', out);
  }
  for (const payload of ANSWERED) {
    const answer = output(runHook(grepHook, payload, env));
    const text = answer.additionalContext ?? answer.permissionDecisionReason ?? '';
    report(
      `${name}: answers ${JSON.stringify(payload.tool_input)}`,
      text.includes('src/b.ts'),
      text,
    );
  }
}
const header = grepAnswer().split('\n')[0];
report(
  'the context starts with one short line',
  header === 'Code graph answer for `widgetFactory` (the grep still runs):',
  header,
);

write('src/b.ts', "import { widgetFactory } from './a';\nexport const made = widgetFactory();\n");
const scripted = execFileSync(process.execPath, ['--no-warnings', startHook], {
  cwd: repo,
  input: JSON.stringify({ cwd: repo, hook_event_name: 'SessionStart', session_id: 's2' }),
  env: { ...process.env, CLAUDE_DB_CAPTURE: 'off' },
  encoding: 'utf8',
});
report('session start with capture off prints no start block', scripted === '', scripted);
report('and starts no graph scan', !existsSync(lock));

const scanPath = (path) =>
  execFileSync(process.execPath, ['--no-warnings', cli, 'scan', '--path', path], {
    cwd: repo,
    stdio: 'ignore',
  });
const storedFiles = async (store, project) =>
  (await store.scannedFiles(project)).map((file) => file.path);

const other = join(homedir(), 'other');
mkdirSync(join(other, 'src'), { recursive: true });
writeFileSync(join(other, 'src', 'z.ts'), 'export const zed = 1;\n');
execFileSync('git', ['init', '-q'], { cwd: other });

const ctx = await createContext();
try {
  scanPath(join(repo, 'src'));
  const inside = await storedFiles(ctx.store, repo);
  report(
    'scan --path inside the repo scans the whole repo project',
    inside.includes('src/a.ts') && inside.includes('src/b.ts'),
    inside.join(' '),
  );

  scanPath(other);
  const current = await storedFiles(ctx.store, repo);
  const elsewhere = await storedFiles(ctx.store, realpathSync(other));
  report(
    'scan --path in another repo writes no graph rows under the current project',
    !current.includes('src/z.ts') && current.includes('src/a.ts'),
    current.join(' '),
  );
  report(
    'and the other repo is scanned under its own project',
    elsewhere.includes('src/z.ts'),
    elsewhere.join(' '),
  );
} finally {
  await ctx.close();
}
