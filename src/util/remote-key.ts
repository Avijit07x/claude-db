const REMOTE_NAME = /^[A-Za-z0-9._-]+$/;
const SCHEME_URL = /^([a-z][a-z0-9+.-]*):\/\/(.+)$/i;
const SCP_URL = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/;
const WINDOWS_PATH = /^[a-z]:[\\/]/i;
const NETWORK_SCHEMES = new Set(['http', 'https', 'ssh', 'git', 'git+ssh', 'ssh+git']);

export const DEFAULT_REMOTE = 'origin';

export function isRemoteName(name: string): boolean {
  return REMOTE_NAME.test(name);
}

function splitAuthority(rest: string): { authority: string; path: string } {
  const slash = rest.indexOf('/');
  return slash === -1
    ? { authority: rest, path: '' }
    : { authority: rest.slice(0, slash), path: rest.slice(slash + 1) };
}

function hostOf(authority: string): string {
  const withoutUser = authority.slice(authority.lastIndexOf('@') + 1);
  return withoutUser.replace(/:\d*$/, '').toLowerCase();
}

function cleanPath(path: string): string {
  return path
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function join(host: string, path: string): string | null {
  const segments = path.split('/').filter((part) => part.length > 0);
  if (host.length === 0 || segments.length < 2 || segments.includes('..')) return null;
  return `${host}/${segments.join('/')}`;
}

export function normalizeRemote(url: string): string | null {
  const text = url.trim();
  if (text.length === 0 || WINDOWS_PATH.test(text)) return null;

  const scheme = SCHEME_URL.exec(text);
  if (scheme) {
    const [, name = '', rest = ''] = scheme;
    if (!NETWORK_SCHEMES.has(name.toLowerCase())) return null;
    const { authority, path } = splitAuthority(rest);
    return join(hostOf(authority), cleanPath(path));
  }

  const scp = SCP_URL.exec(text);
  if (scp) return join((scp[1] ?? '').toLowerCase(), cleanPath(scp[2] ?? ''));

  return null;
}
