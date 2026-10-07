import { moduleTree, parseUses, stripRust } from './rust-modules.mjs';
import { readAll } from './text.mjs';
import { isTopLevel } from './tools.mjs';

const MAX_REEXPORT_DEPTH = 5;
const DECLARATIONS = /\b(?:fn|struct|enum|trait|type|mod|const|static|union)\s+\w+/g;
const USE_STATEMENTS = /(^|[;{}\s])use\s+[^;]+;/g;
const MOD_LINES = /\bmod\s+\w+\s*;/g;
const NOT_IMPORTED = new Set(['*', 'self']);

const blank = (text) => text.replace(/[^\n]/g, ' ');

function resolver(tree) {
  return (crate, path, parts) => {
    let owner = crate;
    let module = [...path];
    let index = 0;
    if (parts[0] === 'crate') {
      module = [];
      index = 1;
    } else if (parts[0] === 'self') {
      index = 1;
    } else if (parts[0] === 'super') {
      while (parts[index] === 'super') {
        module = module.slice(0, -1);
        index += 1;
      }
    } else if (parts.length > 0 && !tree.moduleFile(owner, [...module, parts[0]])) {
      const library = tree.libraries.get(parts[0]);
      if (!library) return null;
      owner = library;
      module = [];
      index = 1;
    }
    for (const part of parts.slice(index)) {
      module = [...module, part];
      if (!tree.moduleFile(owner, module)) return null;
    }
    return { crate: owner, module };
  };
}

function itemFinder(tree, defined, usesOf) {
  const resolve = resolver(tree);
  const find = (crate, module, name, depth, seen) => {
    const file = tree.moduleFile(crate, module);
    if (!file) return null;
    if (defined.has(`${file}\0${name}`)) return { file, name };
    const key = `${file}\0${name}`;
    if (depth > MAX_REEXPORT_DEPTH || seen.has(key)) return null;
    seen.add(key);
    for (const use of usesOf(file)) {
      const last = use.path.at(-1);
      const glob = last === '*';
      if (!glob && (use.alias ?? last) !== name) continue;
      const target = resolve(crate, module, use.path.slice(0, -1));
      if (!target) continue;
      const hit = find(target.crate, target.module, glob ? name : last, depth + 1, seen);
      if (hit) return hit;
    }
    return null;
  };
  return {
    resolve,
    find: (crate, module, name) => find(crate, module, name, 0, new Set()),
  };
}

const codeLines = (stripped) =>
  stripped
    .replace(USE_STATEMENTS, blank)
    .replace(MOD_LINES, blank)
    .replace(DECLARATIONS, blank)
    .split('\n');

function usesOfName(file, lines, local, item) {
  const pattern = new RegExp(`(?<![\\w.:])${local}(?![\\w])`);
  const target = `${item.file}\0${item.name}`;
  const found = [];
  lines.forEach((line, index) => {
    if (pattern.test(line)) {
      found.push({ bucket: 'use', file, line: index + 1, target, name: item.name });
    }
  });
  return found;
}

export function expected({ root, files, result }) {
  const sources = readAll(
    root,
    files.filter((file) => file.endsWith('.rs') || file.endsWith('Cargo.toml')),
  );
  const tree = moduleTree(files, sources);
  const defined = new Set(
    result.symbols.filter(isTopLevel).map((symbol) => `${symbol.file}\0${symbol.name}`),
  );
  const parsed = new Map();
  const usesOf = (file) => {
    if (!parsed.has(file)) parsed.set(file, parseUses(stripRust(sources.get(file) ?? '')));
    return parsed.get(file);
  };
  const items = itemFinder(tree, defined, usesOf);

  const entries = [];
  for (const [file, here] of tree.fileModule) {
    const lines = codeLines(stripRust(sources.get(file) ?? ''));
    for (const use of usesOf(file)) {
      const last = use.path.at(-1);
      if (!last || NOT_IMPORTED.has(last)) continue;
      const target = items.resolve(here.crate, here.path, use.path.slice(0, -1));
      const item = target && items.find(target.crate, target.module, last);
      if (!item) continue;
      const key = `${item.file}\0${item.name}`;
      entries.push({ bucket: 'import', file, line: use.line, target: key, name: item.name });
      const local = use.alias ?? last;
      if (local !== '_') entries.push(...usesOfName(file, lines, local, item));
    }
  }
  return { entries, inScope: null, note: 'text checker: mod tree and use paths' };
}
