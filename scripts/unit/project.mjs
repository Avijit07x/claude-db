import { check } from '../lib/check.mjs';
import { e, now, day } from '../lib/fixtures.mjs';

export default async function run() {
  {
    const { mkdtempSync, mkdirSync, symlinkSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { resolveProject } = await import('../../dist/util/project.js');

    const base = mkdtempSync(join(tmpdir(), 'proj-'));
    const real = join(base, 'real-project');
    const link = join(base, 'linked-project');
    mkdirSync(real);
    symlinkSync(real, link);

    check(
      'symlinked path resolves to the real one',
      resolveProject(link) === resolveProject(real),
      resolveProject(link),
    );
    check(
      'nonexistent path still returns an absolute path',
      resolveProject(join(base, 'not-created')).startsWith('/'),
    );

    const { realpathSync, writeFileSync } = await import('node:fs');

    const repo = join(base, 'repo');
    mkdirSync(join(repo, 'frontend', 'src'), { recursive: true });
    mkdirSync(join(repo, '.git'));
    check(
      'a subdirectory keys the repository root',
      resolveProject(join(repo, 'frontend', 'src')) === realpathSync(repo),
    );

    const worktree = join(base, 'worktree');
    mkdirSync(join(worktree, 'pkg'), { recursive: true });
    writeFileSync(join(worktree, '.git'), 'gitdir: /elsewhere\n');
    check(
      '.git as a file (worktrees, submodules) still counts',
      resolveProject(join(worktree, 'pkg')) === realpathSync(worktree),
    );

    const workspace = join(base, 'workspace');
    mkdirSync(join(workspace, 'repo-a', '.git'), { recursive: true });
    mkdirSync(join(workspace, 'repo-b', '.git'), { recursive: true });
    check(
      'a folder holding several repos keeps its own key',
      resolveProject(workspace) === realpathSync(workspace),
    );
    check(
      'each repo inside it still keys separately',
      resolveProject(join(workspace, 'repo-a')) === realpathSync(join(workspace, 'repo-a')),
    );

    rmSync(base, { recursive: true, force: true });
  }
}
