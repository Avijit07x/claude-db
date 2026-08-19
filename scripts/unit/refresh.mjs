import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../lib/check.mjs';
import { install } from '../../dist/cli/install.js';
import { refreshInstalled } from '../../dist/cli/refresh.js';
import { instructionsPathFor, skillPathFor } from '../../dist/cli/paths.js';

export default async function run() {
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

  const current = readFileSync(instructions, 'utf8');
  writeFileSync(
    instructions,
    current.replace('<!-- claude-db:start -->', '<!-- claude-db:start -->\nOLD TEXT FROM 0.4'),
  );
  refreshInstalled(dist, repo);
  const healed = readFileSync(instructions, 'utf8');
  check('a stale instruction block is rewritten', !healed.includes('OLD TEXT FROM 0.4'));
  check('the block markers survive', healed.includes('<!-- claude-db:start -->'));

  const userText = 'my own notes, written by hand\n';
  writeFileSync(instructions, userText + readFileSync(instructions, 'utf8'));
  refreshInstalled(dist, repo);
  check(
    "a user's own text in the same file is preserved",
    readFileSync(instructions, 'utf8').includes('my own notes, written by hand'),
  );

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
    env: { ...process.env, CLAUDE_DB_URL: join(live, 'memory.db') },
    stdio: ['pipe', 'ignore', 'ignore'],
  });

  check(
    'the SessionStart hook itself repairs a stale skill, even with no memory yet',
    readFileSync(skillPathFor('project', live), 'utf8') === packaged,
  );
  rmSync(live, { recursive: true, force: true });
}
