import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRAMMARS, PLATFORM } from '../dist/graph/grammars.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST = join(ROOT, 'package.json');
const require = createRequire(MANIFEST);
const PREFIX = 'claude-db-grammars-';
const LIBRARY = 'parser.so';

export const PLATFORMS = {
  'linux-x64': { os: 'linux', cpu: 'x64', libc: 'glibc', prebuild: 'Linux-X64' },
  'linux-arm64': { os: 'linux', cpu: 'arm64', libc: 'glibc', prebuild: 'Linux-ARM64' },
  'darwin-x64': { os: 'darwin', cpu: 'x64', prebuild: 'macOS-X64' },
  'darwin-arm64': { os: 'darwin', cpu: 'arm64', prebuild: 'macOS-ARM64' },
  'win32-x64': { os: 'win32', cpu: 'x64', prebuild: 'Windows-X64' },
};

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

function grammarSource(name) {
  const id = `@ast-grep/lang-${name}`;
  const folder = dirname(require.resolve(`${id}/package.json`));
  const manifest = readJson(join(folder, 'package.json'));
  const { extensions, languageSymbol, expandoChar } = require(id);
  const upstream = Object.keys(manifest.devDependencies ?? {}).find(
    (dep) => dep.startsWith('tree-sitter-') && dep !== 'tree-sitter-cli',
  );
  return {
    name,
    folder,
    meta: { file: `${name}.so`, extensions, languageSymbol, expandoChar },
    credit: `${name}.so: ${id}@${manifest.version}, built from ${upstream}@${manifest.devDependencies[upstream]}`,
  };
}

const INDEX = `const { join } = require('node:path');
const grammars = require('./grammars.json');

module.exports = Object.fromEntries(
  Object.entries(grammars).map(([name, grammar]) => [
    name,
    { ...grammar, libraryPath: join(__dirname, grammar.file) },
  ]),
);
`;

function manifestFor(platform, target, root) {
  return {
    name: `${PREFIX}${platform}`,
    version: root.version,
    description: `Prebuilt tree-sitter grammars that claude-db reads code with, for ${platform}.`,
    license: 'MIT',
    repository: root.repository,
    os: [target.os],
    cpu: [target.cpu],
    ...(target.libc ? { libc: [target.libc] } : {}),
    main: 'index.js',
    files: ['index.js', 'grammars.json', '*.so', 'LICENSE-*', 'NOTICE'],
  };
}

function buildPlatform(platform, sources, out, root) {
  const target = PLATFORMS[platform];
  if (!target) throw new Error(`no grammar package for ${platform}`);
  const folder = join(out, `${PREFIX}${platform}`);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  for (const source of sources) {
    copyFileSync(
      join(source.folder, 'prebuilds', `prebuild-${target.prebuild}`, LIBRARY),
      join(folder, source.meta.file),
    );
    copyFileSync(join(source.folder, 'LICENSE'), join(folder, `LICENSE-${source.name}`));
  }
  const grammars = Object.fromEntries(sources.map((source) => [source.name, source.meta]));
  writeFileSync(join(folder, 'grammars.json'), `${JSON.stringify(grammars, null, 2)}\n`);
  writeFileSync(join(folder, 'index.js'), INDEX);
  writeFileSync(join(folder, 'NOTICE'), `${sources.map((source) => source.credit).join('\n')}\n`);
  const manifest = manifestFor(platform, target, root);
  writeFileSync(join(folder, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return folder;
}

export function build({ out, platforms = Object.keys(PLATFORMS) }) {
  const root = readJson(MANIFEST);
  const sources = GRAMMARS.map(grammarSource);
  return platforms.map((platform) => buildPlatform(platform, sources, out, root));
}

export function link(path = MANIFEST) {
  const root = readJson(path);
  const optional = Object.fromEntries(
    Object.keys(PLATFORMS).map((platform) => [`${PREFIX}${platform}`, root.version]),
  );
  writeFileSync(path, `${JSON.stringify({ ...root, optionalDependencies: optional }, null, 2)}\n`);
}

function valueAfter(args, flag) {
  const at = args.indexOf(flag);
  return at < 0 ? undefined : args[at + 1];
}

function main(args) {
  const [command] = args;
  if (command === 'link') return link();
  if (command !== 'build')
    throw new Error('usage: grammars.mjs build --out <dir> [--platform <p>|current] | link');
  const out = valueAfter(args, '--out');
  if (!out) throw new Error('build needs --out <dir>');
  const chosen = valueAfter(args, '--platform');
  const platforms = chosen ? [chosen === 'current' ? PLATFORM : chosen] : undefined;
  for (const folder of build({ out, ...(platforms ? { platforms } : {}) })) console.log(folder);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
