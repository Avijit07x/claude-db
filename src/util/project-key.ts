import { execFileSync } from 'node:child_process';
import { DEFAULT_REMOTE, isRemoteName, normalizeRemote } from './remote-key.js';

const GIT_TIMEOUT_MS = 3000;

export type RemoteReader = (folder: string, remote: string) => string | null;

export interface ProjectKeyOptions {
  remote?: string;
  readRemote?: RemoteReader;
}

export function readRemoteUrl(folder: string, remote: string): string | null {
  try {
    const url = execFileSync('git', ['-C', folder, 'config', '--get', `remote.${remote}.url`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_TIMEOUT_MS,
    }).trim();
    return url.length > 0 ? url : null;
  } catch {
    return null;
  }
}

export function projectKey(folder: string, options: ProjectKeyOptions = {}): string {
  const { remote = DEFAULT_REMOTE, readRemote = readRemoteUrl } = options;
  if (!isRemoteName(remote)) return folder;
  const url = readRemote(folder, remote);
  return (url === null ? null : normalizeRemote(url)) ?? folder;
}
