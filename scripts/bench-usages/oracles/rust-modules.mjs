import { dirname, join } from 'node:path';
import { codeOnly } from './lexer.mjs';

const MOD_DECLARATION = /^[ \t]*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm;
const PATH_ATTRIBUTE = /#\[path\s*=\s*"([^"]+)"\]\s*$/;
const USE_STATEMENT = /(?:^|[;{}\s])use\s+([^;]+);/g;
const USE_TOKEN = /[A-Za-z_][A-Za-z0-9_]*|::|[{},*]/g;
const PACKAGE_NAME = /^\[package\][\s\S]*?^name\s*=\s*"([^"]+)"/m;
const EXTRA_ROOT = /^(src\/bin|tests|examples|benches)\/[^/]+(\.rs|\/main\.rs)$/;

export const stripRust = (source) => codeOnly(source, { rust: true, nested: true });

const lineAt = (source, offset) => source.slice(0, offset).split('\n').length;

function parseTree(tokens, state, prefix, leaves) {
  const path = [...prefix];
  while (state.at < tokens.length) {
    const token = tokens[state.at];
    state.at += 1;
    if (token.text === '::') continue;
    if (token.text === '{') {
      while (state.at < tokens.length && tokens[state.at].text !== '}') {
        if (tokens[state.at].text === ',') state.at += 1;
        else parseTree(tokens, state, path, leaves);
      }
      state.at += 1;
      return;
    }
    path.push(token.text);
    const next = tokens[state.at]?.text;
    if (next === '::') continue;
    let alias;
    if (next === 'as') {
      alias = tokens[state.at + 1]?.text;
      state.at += 2;
    }
    leaves.push({ path, alias, offset: token.offset });
    return;
  }
}

export function parseUses(stripped) {
  const leaves = [];
  for (const statement of stripped.matchAll(USE_STATEMENT)) {
    const body = statement[1];
    const start = statement.index + statement[0].indexOf(body);
    const tokens = [...body.matchAll(USE_TOKEN)].map((match) => ({
      text: match[0],
      offset: start + match.index,
    }));
    const found = [];
    parseTree(tokens, { at: 0 }, [], found);
    for (const leaf of found) {
      leaves.push({ path: leaf.path, alias: leaf.alias, line: lineAt(stripped, leaf.offset) });
    }
  }
  return leaves;
}

function cratesOf(files, fileSet, sources) {
  const crates = [];
  for (const manifest of files.filter((file) => file.endsWith('Cargo.toml'))) {
    const name = PACKAGE_NAME.exec(sources.get(manifest) ?? '')?.[1]?.replace(/-/g, '_');
    if (!name) continue;
    const dir = dirname(manifest) === '.' ? '' : dirname(manifest);
    const lib = join(dir, 'src/lib.rs');
    const main = join(dir, 'src/main.rs');
    if (fileSet.has(lib)) crates.push({ file: lib, name, lib: true });
    if (fileSet.has(main)) crates.push({ file: main, name, lib: false });
    for (const file of fileSet) {
      if (EXTRA_ROOT.test(relativeTo(dir, file))) crates.push({ file, name: null, lib: false });
    }
  }
  return crates;
}

function relativeTo(dir, file) {
  if (!dir) return file;
  return file.startsWith(`${dir}/`) ? file.slice(dir.length + 1) : '';
}

function childFile({ file, isRoot, name, raw, offset, fileSet }) {
  const attribute = PATH_ATTRIBUTE.exec(raw.slice(0, offset));
  if (attribute) {
    const target = join(dirname(file), attribute[1]);
    return fileSet.has(target) ? target : null;
  }
  const base = isRoot ? dirname(file) : file.replace(/\.rs$/, '');
  const folder = base === '.' ? '' : base;
  const candidates = [join(folder, `${name}.rs`), join(folder, name, 'mod.rs')];
  return candidates.find((candidate) => fileSet.has(candidate)) ?? null;
}

export function moduleTree(files, sources) {
  const rustFiles = new Set(files.filter((file) => file.endsWith('.rs')));
  const crates = cratesOf(files, rustFiles, sources);
  const modules = new Map();
  const fileModule = new Map();
  const walk = (crate, file, path) => {
    const key = `${crate.file}\0${path.join('::')}`;
    if (modules.has(key)) return;
    modules.set(key, file);
    if (!fileModule.has(file)) fileModule.set(file, { crate, path });
    const raw = sources.get(file) ?? '';
    const isRoot = file === crate.file || /(^|\/)mod\.rs$/.test(file);
    for (const declaration of stripRust(raw).matchAll(MOD_DECLARATION)) {
      const name = declaration[1];
      const offset = declaration.index;
      const child = childFile({ file, isRoot, name, raw, offset, fileSet: rustFiles });
      if (child) walk(crate, child, [...path, name]);
    }
  };
  for (const crate of crates) walk(crate, crate.file, []);
  return {
    fileModule,
    moduleFile: (crate, path) => modules.get(`${crate.file}\0${path.join('::')}`),
    libraries: new Map(crates.filter((crate) => crate.lib).map((crate) => [crate.name, crate])),
  };
}
