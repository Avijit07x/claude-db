import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../lib/check.mjs';
import { scanText } from '../lib/fixture-scan.mjs';

const ISOLATED = new URL('./isolated/', import.meta.url).pathname;
const GUARD = "import '../../lib/require-isolated.mjs';";

const rules = (text) => scanText('x.md', text).map((found) => found.rule);
const randomLooking = ['kQ7xR2mZ', 'p9LtW4vB', 'n8cYe3sH', 'd6jUf5aQ'].join('');
const prefixed = ['sk', 'Zx81vQm4', 'Lp92Tn30Rb57', 'Uv44Kc18'].join('-');
const personalPath = ['', 'home', 'alice', 'project'].join('/');

function startByHand(script, env) {
  return spawnSync(process.execPath, ['--no-warnings', join(ISOLATED, script)], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

export default async function run() {
  check(
    'a random-looking token is flagged',
    rules(`value ${randomLooking}`).includes('random-token'),
  );
  check(
    'an obviously fake token is allowed',
    rules('value fakeTok9_exampleNotRealValue-0123456789abcdefghij').length === 0,
  );
  check(
    'setting names and short values are not tokens',
    rules('PLAYWRIGHT_MCP_EXTENSION_TOKEN=abc12345 and MAX_TOKENS=4096').length === 0,
  );
  check('a key with a known prefix is flagged', rules(`key ${prefixed}`).includes('secret-prefix'));
  check(
    'a fake key with a known prefix is allowed',
    rules('key sk-ant-api03-abcdefghijklmnopqrstuvwx').length === 0,
  );
  check(
    'a git hash is not a token',
    rules('commit 94093eb4d3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8').length === 0,
  );
  check(
    'a private key with a body is flagged',
    rules(`-----BEGIN PRIVATE KEY-----\n${'A1b2'.repeat(12)}`).includes('secret-prefix'),
  );
  check(
    'a private key with a stub body is allowed',
    rules('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----').length === 0,
  );
  check(
    'a personal home path is flagged',
    rules(`see ${personalPath}/src`).includes('personal-path'),
  );
  check('a placeholder home path is allowed', rules('cd /home/user/project').length === 0);

  const home = mkdtempSync(join(tmpdir(), 'guard-home-'));
  try {
    const direct = startByHand('cli-run.mjs', { HOME: home });
    check(
      'an isolated script started by hand is refused',
      direct.status === 2 && direct.stderr.includes('Refusing'),
      direct.stderr.trim().slice(0, 80),
    );
    check('and it creates nothing in that home', readdirSync(home).length === 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  const outside = startByHand('cli-run.mjs', { HOME: '/dev/null/home', CLAUDE_DB_ISOLATED: '1' });
  check(
    'a home outside the temp folder is refused even when marked isolated',
    outside.status === 2,
  );

  const scripts = readdirSync(ISOLATED).filter((name) => name.endsWith('-run.mjs'));
  const unguarded = scripts.filter(
    (name) => readFileSync(join(ISOLATED, name), 'utf8').split('\n')[0] !== GUARD,
  );
  check(
    'every isolated script starts with the guard',
    scripts.length > 0 && unguarded.length === 0,
    unguarded.join(', '),
  );
}
