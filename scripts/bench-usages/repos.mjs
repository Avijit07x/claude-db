import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' };
const SAFE = ['-c', 'core.hooksPath=/dev/null', '-c', 'advice.detachedHead=false'];

function git(args, cwd) {
  return execFileSync('git', [...SAFE, ...args], {
    cwd,
    env: GIT_ENV,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function headOf(dir) {
  try {
    return git(['rev-parse', 'HEAD'], dir);
  } catch {
    return '';
  }
}

function fetchCommit(entry, dir) {
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(dir, { recursive: true });
    git(['init', '-q'], dir);
    git(['remote', 'add', 'origin', entry.url], dir);
  }
  git(['fetch', '-q', '--depth', '1', 'origin', entry.commit], dir);
  git(['checkout', '-q', '--force', entry.commit], dir);
}

export function checkout(entry, cacheDir) {
  const dir = join(cacheDir, entry.name);
  if (headOf(dir) !== entry.commit) fetchCommit(entry, dir);
  if (git(['status', '--porcelain', '--untracked-files=no'], dir) !== '') {
    git(['checkout', '-q', '--force', entry.commit], dir);
  }
  if (headOf(dir) !== entry.commit) throw new Error(`${entry.name} is not at ${entry.commit}`);
  return dir;
}

export function trackedFiles(root) {
  return git(['ls-files', '-z'], root).split('\0').filter(Boolean);
}
