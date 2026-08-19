import { check } from '../lib/check.mjs';
import { e, now, day } from '../lib/fixtures.mjs';

export default async function run() {
  {
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { observationsFromGit } = await import('../../dist/capture/index.js');

    const repo = mkdtempSync(join(tmpdir(), 'seed-'));
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: 'ada',
      GIT_AUTHOR_EMAIL: 'ada@example.com',
      GIT_COMMITTER_NAME: 'ada',
      GIT_COMMITTER_EMAIL: 'ada@example.com',
    };
    const git = (...args) => execFileSync('git', ['-C', repo, ...args], { env, stdio: 'ignore' });

    git('init', '-q');
    mkdirSync(join(repo, 'src'));
    writeFileSync(join(repo, 'src', 'index.ts'), 'export const x = 1\n');
    git('add', '-A');
    git(
      'commit',
      '-qm',
      'feat: went with FTS5 instead of a trigram index',
      '-m',
      'The tokenizer is builtin, so there is no extension to install.',
    );

    writeFileSync(join(repo, 'src', 'index.ts'), 'export const x = 2\n');
    git('add', '-A');
    git('commit', '-qm', '0.2.0');

    const seeded = observationsFromGit(repo, 10);
    check('a commit becomes an observation', seeded.length === 1, `${seeded.length} kept`);
    check('a version bump is not memory', !seeded.some((o) => o.title === '0.2.0'));
    check(
      'the subject becomes the title',
      seeded[0].title === 'feat: went with FTS5 instead of a trigram index',
      seeded[0].title,
    );
    check('the commit body becomes the reasoning', seeded[0].body.includes('tokenizer is builtin'));
    check(
      'changed files are attributed',
      seeded[0].files.some((f) => f.endsWith('src/index.ts')),
      seeded[0].files.join(','),
    );
    check('the directory becomes a tag', seeded[0].tags.includes('src'), seeded[0].tags.join(','));
    check('the commit author is recorded', seeded[0].author === 'ada', seeded[0].author);
    check(
      'a weighed alternative is classified as a decision',
      seeded[0].kind === 'decision',
      seeded[0].kind,
    );
    check('re-seeding produces the same ids', observationsFromGit(repo, 10)[0].id === seeded[0].id);

    rmSync(repo, { recursive: true, force: true });
  }
}
