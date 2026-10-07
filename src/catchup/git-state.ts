import { execFileSync } from 'node:child_process';
import { redact } from '../capture/redact.js';

const GIT_TIMEOUT_MS = 5000;
const STATUS_LINES = 15;
const RECENT_COMMITS = 5;

export interface GitState {
  branch: string | null;
  changed: number;
  status: string[];
  hiddenStatusLines: number;
  commits: string[];
}

export type GitRunner = (args: string[]) => string;

function runGit(project: string): GitRunner {
  return (args) =>
    execFileSync('git', ['-C', project, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_TIMEOUT_MS,
    });
}

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

export function readGitState(project: string, git: GitRunner = runGit(project)): GitState | null {
  try {
    const status = lines(git(['status', '--short']));
    const branch = lines(git(['branch', '--show-current']))[0] ?? null;
    const commits = lines(git(['log', `-n${RECENT_COMMITS}`, '--pretty=format:%h %s'])).map(redact);
    return {
      branch,
      changed: status.length,
      status: status.slice(0, STATUS_LINES),
      hiddenStatusLines: Math.max(0, status.length - STATUS_LINES),
      commits,
    };
  } catch {
    return null;
  }
}
