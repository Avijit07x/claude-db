import { check } from '../lib/check.mjs';
import { seedUsagesRepo } from '../lib/repo.mjs';
import { e, now, day } from '../lib/fixtures.mjs';

export default async function run() {
  {
    const { execFileSync } = await import('node:child_process');
    const { readFileSync, writeFileSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { findUsages } = await import('../../dist/usages/index.js');

    const { repo, git } = seedUsagesRepo();

    const found = findUsages({
      symbol: 'useAuth',
      path: repo,
      regex: false,
      context: 0,
      limit: 100,
    });
    check(
      'finds the definition',
      found.matches.some((m) => m.file === 'src/auth.ts' && m.isDefinition),
    );
    check(
      'finds a call site',
      found.matches.some((m) => m.file === 'src/header.tsx' && !m.isDefinition),
    );
    check(
      'word-boundary excludes a longer identifier',
      !found.matches.some((m) => m.text.includes('useAuthenticated') && m.file === 'src/other.ts'),
    );
    check(
      'gitignored files are not searched',
      !found.matches.some((m) => m.file === 'src/ignored.ts'),
    );

    writeFileSync(join(repo, 'top.ts'), 'useAuth()\n');
    git('add', '-A');
    git('commit', '-qm', 'add a root-level usage');

    const scoped = findUsages({
      symbol: 'useAuth',
      path: join(repo, 'src'),
      regex: false,
      context: 0,
      limit: 100,
    });
    check(
      'an explicit path narrows the search to that subtree',
      scoped.matches.every((m) => m.file.startsWith('src/')),
      scoped.matches.map((m) => m.file),
    );
    check(
      'a match outside the given path is excluded',
      !scoped.matches.some((m) => m.file === 'top.ts'),
    );

    const unscoped = findUsages({
      symbol: 'useAuth',
      path: repo,
      regex: false,
      context: 0,
      limit: 100,
    });
    check(
      'omitting a narrower path still searches the whole repo',
      unscoped.matches.some((m) => m.file === 'top.ts'),
    );

    const fileScoped = findUsages({
      symbol: 'useAuth',
      path: join(repo, 'src', 'auth.ts'),
      regex: false,
      context: 0,
      limit: 100,
    });
    check(
      'a path pointing at a single file scopes the search to it, rather than throwing',
      fileScoped.matches.every((m) => m.file === 'src/auth.ts'),
      fileScoped.matches.map((m) => m.file),
    );

    writeFileSync(
      join(repo, 'src', 'auth.ts'),
      'export function useAuth() {\n  return 1\n}\nexport const useAuthAgain = () => useAuth()\n',
    );
    const withEdit = findUsages({
      symbol: 'useAuth',
      path: repo,
      regex: false,
      context: 0,
      limit: 100,
    });
    check(
      'uncommitted edits to tracked files are seen',
      withEdit.matches.some((m) => m.text.includes('useAuthAgain')),
    );

    writeFileSync(join(repo, 'src', 'new.tsx'), 'useAuth()\n');
    const withNew = findUsages({
      symbol: 'useAuth',
      path: repo,
      regex: false,
      context: 0,
      limit: 100,
    });
    check(
      'untracked files are seen (the case this tool exists for)',
      withNew.matches.some((m) => m.file === 'src/new.tsx'),
    );

    writeFileSync(join(repo, 'src', 'price.ts'), 'export const price$ = 9\n');
    const dollar = findUsages({
      symbol: 'price$',
      path: repo,
      regex: false,
      context: 0,
      limit: 100,
    });
    check(
      'a $ in the symbol is treated literally, not as a regex anchor',
      dollar.matches.some((m) => m.file === 'src/price.ts'),
    );

    const none = findUsages({
      symbol: 'totallyAbsentSymbolXyz',
      path: repo,
      regex: false,
      context: 0,
      limit: 100,
    });
    check(
      'zero matches is a clean empty result, not a thrown error',
      none.matches.length === 0 && none.total === 0,
    );

    for (let i = 0; i < 5; i++) writeFileSync(join(repo, `x${i}.ts`), 'export const capped = 1\n');
    const capped = findUsages({ symbol: 'capped', path: repo, regex: false, context: 0, limit: 2 });
    check('limit caps the returned matches', capped.matches.length === 2);
    check(
      'truncation is reported with the real total',
      capped.truncated && capped.total === 5,
      capped.total,
    );

    const rx = findUsages({
      symbol: '^export const price',
      path: repo,
      regex: true,
      context: 0,
      limit: 100,
    });
    check(
      'regex mode matches a real pattern',
      rx.matches.some((m) => m.file === 'src/price.ts'),
    );

    writeFileSync(
      join(repo, 'blob.bin'),
      Buffer.concat([Buffer.from([0x00, 0x01, 0x02]), Buffer.from('useAuth')]),
    );
    const withBinary = findUsages({
      symbol: 'useAuth',
      path: repo,
      regex: false,
      context: 0,
      limit: 100,
    });
    check(
      'a binary file containing the term does not corrupt the parse or crash',
      withBinary.matches.every((m) => typeof m.line === 'number' && Number.isFinite(m.line)),
    );

    const noContext = findUsages({
      symbol: 'useAuth',
      path: join(repo, 'src'),
      regex: false,
      context: 0,
      limit: 100,
    });
    const withContext = findUsages({
      symbol: 'useAuth',
      path: join(repo, 'src'),
      regex: false,
      context: 1,
      limit: 100,
    });
    check('context lines are not counted toward total', withContext.total === noContext.total, [
      withContext.total,
      noContext.total,
    ]);
    check(
      'context lines are marked, not reported as matches',
      withContext.matches.filter((m) => m.isMatch).length === noContext.total,
    );
    check(
      'context expands the output with surrounding lines',
      withContext.matches.length > noContext.matches.length,
    );

    for (let i = 0; i < 3; i++) {
      writeFileSync(join(repo, `far${i}.ts`), '\n\n\nconst nowhereNear = 1\n\n\n');
    }
    git('add', '-A');
    git('commit', '-qm', 'spread far matches across files');
    const boundedByRealMatches = findUsages({
      symbol: 'nowhereNear',
      path: repo,
      regex: false,
      context: 2,
      limit: 2,
    });
    check(
      'limit still bounds real matches, not context-inflated rows',
      boundedByRealMatches.matches.filter((m) => m.isMatch).length === 2,
      boundedByRealMatches.matches.filter((m) => m.isMatch).length,
    );

    const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'buffer' })
      .toString('utf8')
      .split('\0')
      .filter((name) => /\.(ts|mjs|js|json|sql|md)$/.test(name));
    const binaryToGit = tracked.filter((name) =>
      readFileSync(join(process.cwd(), name)).includes(0),
    );
    check(
      'no tracked source file contains a NUL byte (it would be invisible to find_usages)',
      binaryToGit.length === 0,
      binaryToGit.join(', '),
    );

    rmSync(repo, { recursive: true, force: true });
  }
}
