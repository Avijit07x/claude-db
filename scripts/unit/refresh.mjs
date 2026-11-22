import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../lib/check.mjs';
import { install } from '../../dist/cli/install.js';
import { readText } from '../../dist/cli/files.js';
import { refreshInstalled } from '../../dist/cli/refresh.js';
import { instructionsPathFor, skillPathFor } from '../../dist/cli/paths.js';

export default async function run() {
  const realHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), 'refresh-home-'));
  process.env.HOME = home;
  try {
    await checks();
  } finally {
    process.env.HOME = realHome;
    rmSync(home, { recursive: true, force: true });
  }
}

async function checks() {
  const dist = new URL('../../dist', import.meta.url).pathname;
  const packaged = readFileSync(join(dist, '..', 'skills', 'cdb-scan', 'SKILL.md'), 'utf8');

  const repo = mkdtempSync(join(tmpdir(), 'refresh-'));
  install(dist, 'project', repo);

  const skill = skillPathFor('project', repo);
  const instructions = instructionsPathFor('project', repo);

  check('install put the skill in place', readFileSync(skill, 'utf8') === packaged);
  check('nothing to refresh right after install', refreshInstalled(dist, repo).length === 0);

  writeFileSync(skill, '# stale copy from an older release\n');
  const afterSkill = refreshInstalled(dist, repo);
  check('a stale skill is repaired', readFileSync(skill, 'utf8') === packaged);
  check('and it reports what it fixed', afterSkill.includes(skill), afterSkill.join(','));

  const oldBlock = '<!-- claude-db:start -->\nOLD TEXT FROM 0.4\n<!-- claude-db:end -->';
  const userText = 'my own notes, written by hand\n';
  check('install wrote no instruction block', readText(instructions) === '');

  writeFileSync(instructions, `${userText}\n${oldBlock}\n`);
  const afterBlock = refreshInstalled(dist, repo);
  check(
    'refresh removes an old instruction block and keeps the whole of the user text',
    readFileSync(instructions, 'utf8') === userText,
    readFileSync(instructions, 'utf8'),
  );
  check('and it reports the file', afterBlock.includes(instructions), afterBlock.join(','));
  check('a second refresh has nothing left to do', refreshInstalled(dist, repo).length === 0);

  writeFileSync(instructions, `${oldBlock}\n`);
  refreshInstalled(dist, repo);
  check('a file holding only the old block is removed', !existsSync(instructions));

  rmSync(repo, { recursive: true, force: true });

  const clean = mkdtempSync(join(tmpdir(), 'refresh-none-'));
  const refreshedNothing = refreshInstalled(dist, clean);
  check('nothing is installed into a project that never asked', refreshedNothing.length === 0);
  check('and no skill file is conjured up', !existsSync(skillPathFor('project', clean)));
  rmSync(clean, { recursive: true, force: true });

  const removed = mkdtempSync(join(tmpdir(), 'refresh-gone-'));
  install(dist, 'project', removed);
  rmSync(join(removed, '.claude', 'skills'), { recursive: true, force: true });
  refreshInstalled(dist, removed);
  check('an uninstalled skill is not resurrected', !existsSync(skillPathFor('project', removed)));
  rmSync(removed, { recursive: true, force: true });

  const { execFileSync } = await import('node:child_process');
  const live = mkdtempSync(join(tmpdir(), 'refresh-hook-'));
  execFileSync('git', ['-C', live, 'init', '-q']);
  install(dist, 'project', live);
  writeFileSync(skillPathFor('project', live), '# stale\n');

  execFileSync(process.execPath, [join(dist, 'hooks', 'session-start.js')], {
    input: JSON.stringify({ cwd: live, session_id: 'refresh-test' }),
    env: {
      ...process.env,
      HOME: live,
      CLAUDE_DB_URL: join(live, 'memory.db'),
      CLAUDE_DB_CAPTURE: 'off',
    },
    stdio: ['pipe', 'ignore', 'ignore'],
  });

  check(
    'the SessionStart hook itself repairs a stale skill, even with no memory yet',
    readFileSync(skillPathFor('project', live), 'utf8') === packaged,
  );
  rmSync(live, { recursive: true, force: true });
}
