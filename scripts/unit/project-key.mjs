import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../lib/check.mjs';
import { ConfigSchema } from '../../dist/config/index.js';
import { projectKey, readRemoteUrl } from '../../dist/util/project-key.js';
import { isRemoteName, normalizeRemote } from '../../dist/util/remote-key.js';

const KEY = 'github.com/acme/shop';

const SAME_REPOSITORY = [
  'https://github.com/acme/shop.git',
  'https://github.com/acme/shop',
  'https://github.com/acme/shop/',
  'https://github.com/acme/shop.git/',
  'git@github.com:acme/shop.git',
  'git@github.com:acme/shop',
  'ssh://git@github.com/acme/shop.git',
  'ssh://git@github.com:22/acme/shop.git',
  'git+ssh://git@github.com/acme/shop.git',
  'git://github.com/acme/shop.git',
  'http://github.com/acme/shop',
  'https://github.com:443/acme/shop.git',
  'https://GitHub.com/Acme/Shop.GIT',
  'https://user@github.com/acme/shop.git',
  'https://x-access-token:ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/acme/shop.git',
  'https://github.com/acme/shop.git?ref=main#readme',
  '  https://github.com/acme/shop.git\n',
];

const NOT_SHARED = [
  '',
  '   ',
  '/srv/git/shop.git',
  'file:///srv/git/shop.git',
  '../shop',
  './shop.git',
  'C:\\Users\\me\\shop',
  'c:/Users/me/shop',
  'https://github.com',
  'https://github.com/acme',
  'https://github.com/../acme/shop',
  'ftp://github.com/acme/shop.git',
  'shop',
];

function git(folder, ...args) {
  execFileSync('git', ['-C', folder, ...args], { stdio: 'ignore' });
}

function repo(base, name, remotes) {
  const folder = join(base, name);
  mkdirSync(folder, { recursive: true });
  git(folder, 'init', '-q');
  for (const [remote, url] of Object.entries(remotes)) git(folder, 'remote', 'add', remote, url);
  return folder;
}

export default async function run() {
  check(
    'every form of one remote gives one key',
    SAME_REPOSITORY.every((url) => normalizeRemote(url) === KEY),
    SAME_REPOSITORY.filter((url) => normalizeRemote(url) !== KEY)
      .map((url) => `${JSON.stringify(url)} -> ${normalizeRemote(url)}`)
      .join('; '),
  );
  check(
    'a remote that is not a shared address gives no key',
    NOT_SHARED.every((url) => normalizeRemote(url) === null),
    NOT_SHARED.filter((url) => normalizeRemote(url) !== null).join('; '),
  );
  check(
    'a key never holds a user name, a password, a token or a port',
    [...SAME_REPOSITORY, 'https://tok:en@gitlab.com:8443/a/b/c.git'].every((url) => {
      const key = normalizeRemote(url);
      return key !== null && !/[@:?#\s]/.test(key) && !key.includes('ghp_') && !key.includes('tok');
    }),
  );
  check(
    'a group with sub-groups keeps every part',
    normalizeRemote('git@gitlab.com:team/platform/shop.git') === 'gitlab.com/team/platform/shop',
  );
  check(
    'different repositories give different keys',
    normalizeRemote('https://github.com/acme/shop') !==
      normalizeRemote('https://github.com/acme/shop-api') &&
      normalizeRemote('https://github.com/acme/shop') !==
        normalizeRemote('https://github.com/other/shop') &&
      normalizeRemote('https://github.com/acme/shop') !==
        normalizeRemote('https://gitlab.com/acme/shop'),
  );
  check(
    'remote names are checked',
    isRemoteName('origin') &&
      isRemoteName('my-fork_2.x') &&
      !isRemoteName('') &&
      !isRemoteName('a b') &&
      !isRemoteName('a/b') &&
      !isRemoteName('a;b'),
  );

  const asked = [];
  const reader = (url) => (folder, remote) => (asked.push(remote), url);
  check(
    'the key comes from origin by default and the folder is the fallback',
    projectKey('/work/shop', { readRemote: reader('git@github.com:acme/shop.git') }) === KEY &&
      asked[0] === 'origin' &&
      projectKey('/work/shop', { readRemote: reader(null) }) === '/work/shop' &&
      projectKey('/work/shop', { readRemote: reader('/srv/git/shop.git') }) === '/work/shop',
  );
  asked.length = 0;
  check(
    'a configured remote is the one that is read',
    projectKey('/work/shop', {
      remote: 'upstream',
      readRemote: reader(`https://github.com/acme/shop`),
    }) === KEY && asked[0] === 'upstream',
  );
  asked.length = 0;
  check(
    'a bad remote name falls back to the folder and reads nothing',
    projectKey('/work/shop', {
      remote: 'a b',
      readRemote: reader(`https://github.com/acme/shop`),
    }) === '/work/shop' && asked.length === 0,
  );

  check(
    'the setting defaults to origin and refuses a bad name',
    ConfigSchema.parse({}).project.remote === 'origin' &&
      ConfigSchema.parse({ project: { remote: 'upstream' } }).project.remote === 'upstream' &&
      !ConfigSchema.safeParse({ project: { remote: 'a b' } }).success,
  );

  const base = mkdtempSync(join(tmpdir(), 'project-key-'));
  try {
    const first = repo(base, 'clone-one', { origin: 'git@github.com:acme/shop.git' });
    const second = repo(base, 'elsewhere/clone-two', {
      origin: 'https://x-access-token:ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/acme/shop.git',
    });
    check(
      'two real clones in different folders get the same key, with no token in it',
      projectKey(first) === KEY && projectKey(second) === KEY,
      `${projectKey(first)} | ${projectKey(second)}`,
    );

    const bare = repo(base, 'no-remote', {});
    check('a repository with no remote keeps its folder', projectKey(bare) === bare);
    check('a folder that is not a repository keeps its folder', projectKey(base) === base);
    check(
      'a missing folder keeps its folder',
      projectKey(join(base, 'missing')) === join(base, 'missing'),
    );

    const forked = repo(base, 'fork', {
      origin: 'git@github.com:me/shop.git',
      upstream: 'git@github.com:acme/shop.git',
    });
    check(
      'a fork uses origin by default and another remote when it is configured',
      projectKey(forked) === 'github.com/me/shop' &&
        projectKey(forked, { remote: 'upstream' }) === KEY,
    );
    check(
      'a configured remote that does not exist falls back to the folder',
      projectKey(forked, { remote: 'nope' }) === forked,
    );
    check(
      'the real reader returns the raw address and null when there is none',
      readRemoteUrl(first, 'origin') === 'git@github.com:acme/shop.git' &&
        readRemoteUrl(bare, 'origin') === null,
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}
