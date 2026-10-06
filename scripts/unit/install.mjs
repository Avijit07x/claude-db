import { check } from '../lib/check.mjs';

export default async function run() {
  {
    const { install, refreshHooks, uninstall } = await import('../../dist/cli/install.js');
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

    const OURS = [
      'pick-deliver.js',
      'prefer-usages.js',
      'session-end.js',
      'session-start.js',
      'user-prompt.js',
    ];
    const hookFiles = (value) =>
      Object.values(value.hooks)
        .flatMap((entries) =>
          entries.flatMap((entry) => entry.hooks.map((h) => h.command.split('/').pop())),
        )
        .sort();
    const settings = read('.claude/settings.local.json');
    check(
      'install registers every hook exactly once',
      JSON.stringify(hookFiles(settings)) === JSON.stringify(OURS),
      hookFiles(settings).join(' '),
    );
    check(
      'both tool-call hooks are kept: one for Bash and Grep, one for every tool',
      settings.hooks.PreToolUse.length === 2 &&
        settings.hooks.PreToolUse[0].matcher === 'Bash|Grep' &&
        settings.hooks.PreToolUse[1].matcher === undefined &&
        settings.hooks.PreToolUse[1].hooks[0].command.endsWith('/hooks/pick-deliver.js'),
      JSON.stringify(settings.hooks.PreToolUse),
    );
    check(
      'hook commands use forward slashes so they are compatible with a shell on Windows',
      Object.values(settings.hooks).every((entries) =>
        entries.every((entry) => entry.hooks.every((h) => !h.command.includes('\\'))),
      ),
    );

    const windows = mkdtempSync(join(tmpdir(), 'install-win-'));
    install('C:\\Users\\Me\\node_modules\\claude-db\\dist', 'project', windows);
    const winSettings = JSON.parse(
      readFileSync(join(windows, '.claude/settings.local.json'), 'utf8'),
    );
    const winCommands = Object.values(winSettings.hooks).flatMap((entries) =>
      entries.flatMap((entry) => entry.hooks.map((h) => h.command)),
    );
    check(
      'a windows-style install path is written without backslashes, whatever the platform',
      winCommands.every((command) => !command.includes('\\')),
      winCommands[0],
    );
    check(
      'and those hooks are still recognised as ours on uninstall',
      (() => {
        uninstall('C:\\Users\\Me\\node_modules\\claude-db\\dist', 'project', windows);
        const after = JSON.parse(
          readFileSync(join(windows, '.claude/settings.local.json'), 'utf8'),
        );
        return !after.hooks;
      })(),
    );
    rmSync(windows, { recursive: true, force: true });
    check('install registers the mcp server', !!read('.mcp.json').mcpServers.memory);

    install('/upgraded/node/claude-db/dist', 'project', repo);
    const upgraded = read('.claude/settings.local.json');
    check(
      'reinstalling from a new path replaces hooks instead of stacking',
      JSON.stringify(hookFiles(upgraded)) === JSON.stringify(OURS),
      hookFiles(upgraded).join(' '),
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

    const older = mkdtempSync(join(tmpdir(), 'refresh-hooks-'));
    const at = (file) => ({ type: 'command', command: `node ${dist}/hooks/${file}` });
    const mine = { type: 'command', command: 'node /home/me/my-hook.js' };
    const oldSettings = {
      model: 'opus',
      hooks: {
        SessionStart: [{ hooks: [at('session-start.js')] }],
        UserPromptSubmit: [{ hooks: [at('user-prompt.js')] }],
        SessionEnd: [{ hooks: [at('session-end.js')] }],
        PreToolUse: [
          { matcher: 'Write', hooks: [mine] },
          { matcher: 'Bash|Grep', hooks: [{ ...at('prefer-usages.js'), timeout: 10 }] },
        ],
      },
    };
    const oldPath = join(older, 'settings.json');
    writeFileSync(oldPath, JSON.stringify(oldSettings));
    check(
      'an install from before the pick hook is refreshed',
      refreshHooks(dist, oldPath) === true,
    );
    const refreshed = JSON.parse(readFileSync(oldPath, 'utf8'));
    check(
      'the refresh adds the missing hook and keeps every other one',
      JSON.stringify(hookFiles(refreshed)) === JSON.stringify([...OURS, 'my-hook.js'].sort()),
      hookFiles(refreshed).join(' '),
    );
    check(
      "the refresh keeps the user's own settings and hooks",
      refreshed.model === 'opus' && refreshed.hooks.PreToolUse[0].hooks[0].command === mine.command,
    );
    check('a current install is left alone', refreshHooks(dist, oldPath) === false);

    const elsewhere = join(older, 'elsewhere.json');
    const otherCopy = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: 'node /other/dist/hooks/user-prompt.js' }] },
        ],
      },
    });
    writeFileSync(elsewhere, otherCopy);
    check(
      'hooks that point at another copy of claude-db are never rewritten',
      refreshHooks(dist, elsewhere) === false && readFileSync(elsewhere, 'utf8') === otherCopy,
    );
    check(
      'a settings file without our hooks is never touched',
      refreshHooks(dist, join(older, 'missing.json')) === false &&
        !existsSync(join(older, 'missing.json')),
    );
    rmSync(older, { recursive: true, force: true });
  }
}
