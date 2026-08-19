import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'ada',
  GIT_AUTHOR_EMAIL: 'ada@example.com',
  GIT_COMMITTER_NAME: 'ada',
  GIT_COMMITTER_EMAIL: 'ada@example.com',
};

export function newRepo(prefix = 'usages-') {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  const git = (...args) =>
    execFileSync('git', ['-C', repo, ...args], { env: ENV, stdio: 'ignore' });
  git('init', '-q');
  return { repo, git };
}

export function seedUsagesRepo() {
  const { repo, git } = newRepo();
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'auth.ts'), 'export function useAuth() {\n  return 1\n}\n');
  writeFileSync(
    join(repo, 'src', 'header.tsx'),
    'import { useAuth } from "./auth"\nfunction Header() {\n  const a = useAuth()\n  return a\n}\n',
  );
  writeFileSync(join(repo, 'src', 'other.ts'), 'const useAuthenticated = true\n');
  writeFileSync(join(repo, '.gitignore'), 'ignored.ts\n');
  writeFileSync(join(repo, 'src', 'ignored.ts'), 'useAuth()\n');
  git('add', '-A');
  git('commit', '-qm', 'add useAuth');
  return { repo, git };
}
