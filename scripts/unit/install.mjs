import { check } from '../lib/check.mjs';
import { e, now, day } from '../lib/fixtures.mjs';

export default async function run() {
  {
    const { install, uninstall } = await import('../../dist/cli/install.js');
    const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } =
      await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const repo = mkdtempSync(join(tmpdir(), 'install-'));
    const dist = new URL('../../dist', import.meta.url).pathname;
    const read = (name) => {
      try {
        return JSON.parse(readFileSync(join(repo, name), 'utf8'));
      } catch {
        return null;
      }
    };

    writeFileSync(join(repo, 'CLAUDE.local.md'), '# Notes\n\nSomething the user wrote.\n');

    install(dist, 'project', repo);
    install(dist, 'project', repo);

    const guidance = readFileSync(join(repo, 'CLAUDE.local.md'), 'utf8');
    check('install writes standing memory instructions', guidance.includes('`search`'));
    check(
      'installing twice does not duplicate them',
      guidance.split('claude-db:start').length - 1 === 1,
    );
    check("the user's own notes are left alone", guidance.includes('Something the user wrote.'));

    check(
      'install writes the scan skill',
      readFileSync(join(repo, '.claude/skills/cdb-scan/SKILL.md'), 'utf8').includes(
        'profile:stack',
      ),
    );

    const settings = read('.claude/settings.local.json');
    check(
      'install registers every hook exactly once',
      Object.values(settings.hooks).every((entries) => entries.length === 1),
      Object.entries(settings.hooks)
        .map(([k, v]) => `${k}=${v.length}`)
        .join(' '),
    );
    check(
      'hook commands use forward slashes so they are compatible with a shell on Windows',
      Object.values(settings.hooks).every((entries) =>
        entries.every((entry) => entry.hooks.every((h) => !h.command.includes('\\'))),
      ),
    );
    check('install registers the mcp server', !!read('.mcp.json').mcpServers.memory);

    install('/upgraded/node/claude-db/dist', 'project', repo);
    const upgraded = read('.claude/settings.local.json');
    check(
      'reinstalling from a new path replaces hooks instead of stacking',
      Object.values(upgraded.hooks).every((entries) => entries.length === 1),
      Object.entries(upgraded.hooks)
        .map(([k, v]) => `${k}=${v.length}`)
        .join(' '),
    );
    check(
      'the replacement points at the new path',
      upgraded.hooks.SessionStart[0].hooks[0].command.includes('/upgraded/node/'),
    );

    uninstall(dist, 'project', repo);
    check(
      'uninstall removes the mcp server even when it was the only one',
      !read('.mcp.json').mcpServers,
      JSON.stringify(read('.mcp.json')),
    );
    check('uninstall removes the hooks', !read('.claude/settings.local.json').hooks);
    check('uninstall removes the scan skill', !existsSync(join(repo, '.claude/skills/cdb-scan')));

    const afterRemoval = readFileSync(join(repo, 'CLAUDE.local.md'), 'utf8');
    check(
      'uninstall takes back only its own instructions',
      !afterRemoval.includes('claude-db:start') &&
        afterRemoval.includes('Something the user wrote.'),
      afterRemoval.trim(),
    );

    rmSync(repo, { recursive: true, force: true });
  }
}
