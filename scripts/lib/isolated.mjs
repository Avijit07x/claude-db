import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from './check.mjs';

export function report(label, ok, detail = '') {
  console.log(`CHECK ${JSON.stringify([label, Boolean(ok), String(detail ?? '')])}`);
}

const REAL_FOLDER_VARIABLES = ['CLAUDE_CONFIG_DIR', 'CLAUDE_DB_GRAMMARS'];

function isolatedEnv(home) {
  const env = { ...process.env };
  for (const name of REAL_FOLDER_VARIABLES) delete env[name];
  return {
    ...env,
    HOME: home,
    CLAUDE_DB_URL: join(home, 'memory.db'),
    CLAUDE_DB_ISOLATED: '1',
  };
}

export function runIsolated(script) {
  const home = mkdtempSync(join(tmpdir(), 'isolated-home-'));
  try {
    const result = spawnSync(process.execPath, ['--no-warnings', script], {
      env: isolatedEnv(home),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    for (const line of result.stdout.split('\n')) {
      if (!line.startsWith('CHECK ')) continue;
      const [label, ok, detail] = JSON.parse(line.slice(6));
      check(label, ok, detail);
    }
    check(
      `${script.split('/').pop()} ran to the end`,
      result.status === 0,
      result.stderr.trim().split('\n').slice(-2).join(' | '),
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
