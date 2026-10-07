import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../lib/check.mjs';
import { aiSummary } from '../../dist/capture/index.js';
import { describeFailure, runHeadless, runHeadlessResult } from '../../dist/util/claude-cli.js';
import {
  claudeBinary,
  findClaudeAncestor,
  inspectProcess,
  inspectWithPs,
  rememberClaudeBinary,
  rememberedBinary,
  resolveClaude,
} from '../../dist/util/claude-binary.js';

const FAKE_CLAUDE = `#!/usr/bin/env node
let stdin = '';
process.stdin.on('data', (chunk) => (stdin += chunk));
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({
    argv: process.argv.slice(2),
    capture: process.env.CLAUDE_DB_CAPTURE ?? null,
    thinking: process.env.MAX_THINKING_TOKENS ?? null,
    stdin,
  }));
});
`;

const OLD_CLAUDE = `#!/usr/bin/env node
const argv = process.argv.slice(2);
const unknown = argv.find((arg) => arg === '--no-session-persistence' || arg === '--effort');
if (unknown) {
  process.stderr.write("error: unknown option '" + unknown + "'\\n");
  process.exit(1);
}
process.stdout.write(JSON.stringify({ argv }));
`;

const NO_STRICT_CLAUDE = `#!/usr/bin/env node
const argv = process.argv.slice(2);
if (argv.includes('--strict-mcp-config')) {
  process.stderr.write("error: unknown option '--strict-mcp-config'\\n");
  process.exit(1);
}
process.stdout.write(JSON.stringify({ argv }));
`;

const BROKEN_CLAUDE = `#!/usr/bin/env node
process.stderr.write('error: not logged in\\n');
process.exit(1);
`;

const SLOW_CLAUDE = `#!/usr/bin/env node
setTimeout(() => {}, 30000);
`;

function script(dir, name, body) {
  const path = join(dir, name);
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
}

export default async function run() {
  const nothing = () => null;
  const none = { remembered: nothing, ancestor: nothing, onPath: nothing };
  check(
    'the running Claude Code binary is preferred',
    claudeBinary({ CLAUDE_CODE_EXECPATH: '/opt/claude' }, none) === '/opt/claude',
  );
  check(
    'claude on PATH is the fallback',
    claudeBinary({}, none) === 'claude' &&
      claudeBinary({ CLAUDE_CODE_EXECPATH: '' }, none) === 'claude',
  );
  check(
    'a remembered binary is used when the running one is unknown',
    claudeBinary({}, { ...none, remembered: () => '/opt/remembered' }) === '/opt/remembered' &&
      claudeBinary(
        { CLAUDE_CODE_EXECPATH: '/opt/claude' },
        { ...none, remembered: () => '/opt/remembered' },
      ) === '/opt/claude',
  );
  const all = {
    remembered: () => '/opt/saved',
    ancestor: () => '/opt/parent',
    onPath: () => '/opt/onpath',
  };
  const sourceOf = (env, lookup) => JSON.stringify(resolveClaude(env, lookup));
  check(
    'the lookup names each source, in order',
    sourceOf({ CLAUDE_CODE_EXECPATH: '/opt/env' }, all) ===
      '{"path":"/opt/env","source":"CLAUDE_CODE_EXECPATH"}' &&
      sourceOf({}, all) === '{"path":"/opt/saved","source":"saved path"}' &&
      sourceOf({}, { ...all, remembered: nothing }) ===
        '{"path":"/opt/parent","source":"parent process"}' &&
      sourceOf({}, { ...all, remembered: nothing, ancestor: nothing }) ===
        '{"path":"/opt/onpath","source":"PATH"}',
  );
  check('the lookup gives nothing when claude is nowhere', resolveClaude({}, none) === null);
  check(
    'claudeBinary and resolveClaude agree for the same environment',
    ['{}', '{"CLAUDE_CODE_EXECPATH":"/opt/env"}'].every((text) => {
      const env = JSON.parse(text);
      return claudeBinary(env, all) === resolveClaude(env, all)?.path;
    }),
  );

  const dir = mkdtempSync(join(tmpdir(), 'claude-cli-'));
  const memory = join(dir, 'claude-binary');
  const target = join(dir, 'real-claude');
  writeFileSync(target, FAKE_CLAUDE);
  chmodSync(target, 0o755);
  check('nothing is remembered at first', rememberedBinary(memory) === null);
  rememberClaudeBinary({}, memory, nothing);
  check('a run that finds no binary remembers nothing', rememberedBinary(memory) === null);
  rememberClaudeBinary({}, memory, () => target);
  check('a hook run records the binary it was started by', rememberedBinary(memory) === target);
  rmSync(memory);
  rememberClaudeBinary({ CLAUDE_CODE_EXECPATH: target }, memory, nothing);
  check('the variable is recorded when it is set', rememberedBinary(memory) === target);
  let searched = 0;
  rememberClaudeBinary({}, memory, () => (searched++, null));
  check('a still valid record is not searched for again', searched === 0);
  check('the record is one line holding the path', readFileSync(memory, 'utf8') === `${target}\n`);
  const table = {
    10: { parent: 20, exe: '/usr/bin/dash' },
    20: { parent: 30, exe: '/opt/editor/native-binary/claude' },
    30: { parent: 40, exe: '/usr/bin/zsh' },
    40: { parent: 1, exe: '/usr/bin/code' },
  };
  const inspect = (pid) => table[pid] ?? null;
  check(
    'the Claude binary is found above the shell a hook runs in',
    findClaudeAncestor(10, inspect) === '/opt/editor/native-binary/claude',
  );
  check(
    'a start that is Claude itself is found',
    findClaudeAncestor(20, inspect) === table[20].exe,
  );
  check('a chain with no Claude gives nothing', findClaudeAncestor(30, inspect) === null);
  check('an unknown process stops the search', findClaudeAncestor(99, inspect) === null);
  const self = inspectProcess(process.pid);
  check(
    'the real inspection finds this process, its parent and an existing executable',
    self !== null &&
      Number.isInteger(self.parent) &&
      self.parent > 0 &&
      self.parent === process.ppid &&
      existsSync(self.exe),
    JSON.stringify(self),
  );
  const viaPs = process.platform === 'win32' ? null : inspectWithPs(process.pid);
  check(
    'the ps reading finds this process and its parent',
    process.platform === 'win32' ||
      (viaPs !== null && viaPs.parent === process.ppid && viaPs.exe.length > 0),
    JSON.stringify(viaPs),
  );
  const loop = () => ({ parent: 7, exe: '/usr/bin/sh' });
  check('a loop in the chain cannot hang the search', findClaudeAncestor(7, loop) === null);
  rmSync(target);
  check('a binary that is gone is no longer used', rememberedBinary(memory) === null);
  writeFileSync(memory, '\n');
  check('an empty record is ignored', rememberedBinary(memory) === null);
  const fake = join(dir, 'claude');
  writeFileSync(fake, FAKE_CLAUDE);
  chmodSync(fake, 0o755);

  const saved = process.env.CLAUDE_CODE_EXECPATH;
  try {
    process.env.CLAUDE_CODE_EXECPATH = fake;
    const started = Date.now();
    const raw = await runHeadless('summarize this', 'haiku', 5_000);
    const reply = raw === null ? null : JSON.parse(raw);
    check('a headless call reaches the binary and returns its output', reply !== null);
    check(
      'stdin is closed at once, so the CLI never waits for input',
      reply !== null && Date.now() - started < 4_000,
      `${Date.now() - started}ms`,
    );
    check(
      'it asks for the model, low effort, and no saved session',
      reply?.argv.join(' ') ===
        '-p summarize this --model haiku --effort low --no-session-persistence',
      reply?.argv.join(' '),
    );
    check('the child session is never captured as memory', reply?.capture === 'off');

    const summary = await aiSummary('Fixed the flush cursor.', 'haiku');
    check(
      'AI summaries go through the same call',
      summary !== null && summary.includes('--no-session-persistence'),
    );

    const picked = JSON.parse(
      (await runHeadless('pick', 'haiku', 5_000, {
        flags: [['--tools', ''], ['--strict-mcp-config']],
        env: { MAX_THINKING_TOKENS: '0', CLAUDE_DB_CAPTURE: 'on' },
      })) ?? '{}',
    );
    check(
      'extra flags are passed after the usual ones, empty values included',
      picked.argv?.join('|') ===
        '-p|pick|--model|haiku|--effort|low|--no-session-persistence|--tools||--strict-mcp-config',
      picked.argv?.join('|'),
    );
    check('extra environment reaches the child', picked.thinking === '0');
    check('extra environment cannot turn capture back on', picked.capture === 'off');

    process.env.CLAUDE_CODE_EXECPATH = script(dir, 'no-strict-claude', NO_STRICT_CLAUDE);
    const lean = await runHeadless('pick', 'haiku', 5_000, {
      flags: [['--tools', ''], ['--strict-mcp-config']],
    });
    check(
      'an extra flag the CLI does not know is dropped and the rest are kept',
      lean !== null &&
        JSON.parse(lean).argv.join('|') ===
          '-p|pick|--model|haiku|--effort|low|--no-session-persistence|--tools|',
      lean ?? 'null',
    );

    process.env.CLAUDE_CODE_EXECPATH = script(dir, 'old-claude', OLD_CLAUDE);
    const old = await runHeadless('summarize this', 'haiku', 5_000);
    check(
      'an older CLI that rejects optional flags is retried without them',
      old !== null && JSON.parse(old).argv.join(' ') === '-p summarize this --model haiku',
      old ?? 'null',
    );

    process.env.CLAUDE_CODE_EXECPATH = script(dir, 'broken-claude', BROKEN_CLAUDE);
    check(
      'any other failure gives null without retrying forever',
      (await runHeadless('x', 'haiku', 5_000)) === null,
    );

    const broken = await runHeadlessResult('x', 'haiku', 5_000);
    check(
      'a failed call says why: the exit code and the first line of the error',
      !broken.ok && broken.reason === 'exited with code 1: error: not logged in',
      broken.ok ? 'ok' : broken.reason,
    );

    process.env.CLAUDE_CODE_EXECPATH = join(dir, 'missing');
    check(
      'a missing binary gives null, not a crash',
      (await runHeadless('x', 'haiku', 5_000)) === null,
    );
    const missing = await runHeadlessResult('x', 'haiku', 5_000);
    check(
      'and says the binary was not found',
      !missing.ok && missing.reason.startsWith('claude was not found'),
      missing.ok ? 'ok' : missing.reason,
    );

    process.env.CLAUDE_CODE_EXECPATH = script(dir, 'slow-claude', SLOW_CLAUDE);
    const slow = await runHeadlessResult('x', 'haiku', 300);
    check(
      'a call that runs out of time says how long it was given',
      !slow.ok && slow.reason === 'timed out after 300 ms',
      slow.ok ? 'ok' : slow.reason,
    );

    process.env.CLAUDE_CODE_EXECPATH = fake;
    const good = await runHeadlessResult('hello', 'haiku', 5_000);
    check('a working call returns its output', good.ok && JSON.parse(good.stdout).stdin === '');
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CODE_EXECPATH;
    else process.env.CLAUDE_CODE_EXECPATH = saved;
  }

  const long = 'x'.repeat(300);
  check(
    'a long error line is cut to one short line',
    describeFailure({ code: 2 }, `\n  ${long}\nsecond`, 1000).length < 150,
  );
  check(
    'a stopped process names the signal',
    describeFailure({ signal: 'SIGKILL', killed: false }, '', 1000) === 'stopped by SIGKILL',
  );
  check(
    'a reply over the buffer is named',
    describeFailure({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, '', 1000).includes('1 MB'),
  );
  check(
    'the command line, which holds the prompt, never reaches the reason',
    !describeFailure(
      { code: 1, message: 'Command failed: claude -p PRIVATE-PROMPT' },
      '',
      1000,
    ).includes('PRIVATE'),
  );
  check(
    'an unknown failure still gives a reason',
    describeFailure(undefined, '', 1000) === 'could not run claude',
  );

  const notRepo = join(dir, 'not-a-repo');
  const probe = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { closeLandedWork } from ${JSON.stringify(new URL('../../dist/capture/index.js', import.meta.url).href)};
       process.stdout.write(String(await closeLandedWork({}, ${JSON.stringify(notRepo)})));`,
    ],
    { encoding: 'utf8' },
  );
  check(
    'outside a git repo, closing work prints nothing to stderr',
    probe.stdout === '0' && probe.stderr === '',
    probe.stderr.trim().slice(0, 80),
  );

  rmSync(dir, { recursive: true, force: true });
}
