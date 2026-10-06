import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../lib/check.mjs';
import { aiSummary } from '../../dist/capture/index.js';
import { claudeBinary, runHeadless } from '../../dist/util/claude-cli.js';

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

function script(dir, name, body) {
  const path = join(dir, name);
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
}

export default async function run() {
  check(
    'the running Claude Code binary is preferred',
    claudeBinary({ CLAUDE_CODE_EXECPATH: '/opt/claude' }) === '/opt/claude',
  );
  check(
    'claude on PATH is the fallback',
    claudeBinary({}) === 'claude' && claudeBinary({ CLAUDE_CODE_EXECPATH: '' }) === 'claude',
  );

  const dir = mkdtempSync(join(tmpdir(), 'claude-cli-'));
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

    process.env.CLAUDE_CODE_EXECPATH = join(dir, 'missing');
    check(
      'a missing binary gives null, not a crash',
      (await runHeadless('x', 'haiku', 5_000)) === null,
    );
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CODE_EXECPATH;
    else process.env.CLAUDE_CODE_EXECPATH = saved;
  }

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
