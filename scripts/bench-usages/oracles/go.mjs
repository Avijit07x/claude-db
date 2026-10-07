import { dirOf, readAll } from './text.mjs';
import { isTopLevel } from './tools.mjs';

const MODULE_LINE = /^module\s+(\S+)/m;
const PACKAGE_LINE = /^package\s+(\w+)/m;
const IMPORTS = /import\s*\(([\s\S]*?)\)|import\s+(?:(\w+|\.|_)\s+)?"([^"]+)"/g;
const IMPORT_LINE = /^\s*(?:(\w+|\.|_)\s+)?"([^"]+)"/;
const SKIPPED_LINE = /^\s*(\/\/|\*|\/\*)|^\s*import\b|^\s*"[^"]+"\s*$/;

export const targetOf = (symbol) => `${dirOf(symbol.file)}\0${symbol.name}`;

function modulesOf(sources, files) {
  return files
    .filter((file) => file === 'go.mod' || file.endsWith('/go.mod'))
    .map((file) => ({ dir: dirOf(file), path: MODULE_LINE.exec(sources.get(file) ?? '')?.[1] }))
    .filter((module) => module.path)
    .sort((a, b) => b.path.length - a.path.length);
}

function dirInModule(module, rest) {
  if (module.dir === '.') return rest || '.';
  return rest ? `${module.dir}/${rest}` : module.dir;
}

function dirResolver(modules, dirs) {
  return (spec) => {
    for (const module of modules) {
      if (spec !== module.path && !spec.startsWith(`${module.path}/`)) continue;
      const dir = dirInModule(module, spec.slice(module.path.length + 1));
      if (dirs.has(dir)) return dir;
    }
    return null;
  };
}

function importsOf(source) {
  const found = [];
  for (const match of source.matchAll(IMPORTS)) {
    if (match[1] === undefined) {
      found.push({ alias: match[2], spec: match[3] });
      continue;
    }
    for (const line of match[1].split('\n')) {
      const entry = IMPORT_LINE.exec(line);
      if (entry) found.push({ alias: entry[1], spec: entry[2] });
    }
  }
  return found;
}

function packageNames(goFiles, sources) {
  const names = new Map();
  for (const file of goFiles) {
    const name = PACKAGE_LINE.exec(sources.get(file))?.[1];
    if (name && !file.endsWith('_test.go') && !names.has(dirOf(file))) {
      names.set(dirOf(file), name);
    }
  }
  return names;
}

const codeOf = (line) =>
  line
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`[^`]*`/g, '``')
    .replace(/\/\/.*$/, '');

export function expected({ root, files, result }) {
  const goFiles = files.filter((file) => file.endsWith('.go'));
  const sources = readAll(root, [...goFiles, ...files.filter((file) => file.endsWith('go.mod'))]);
  const resolveDir = dirResolver(modulesOf(sources, files), new Set(goFiles.map(dirOf)));
  const declared = packageNames(goFiles, sources);
  const known = new Set(result.symbols.filter(isTopLevel).map(targetOf));

  const entries = [];
  for (const file of goFiles) {
    const lines = sources.get(file).split('\n');
    for (const { alias, spec } of importsOf(sources.get(file))) {
      if (alias === '_' || alias === '.') continue;
      const dir = resolveDir(spec);
      const local = dir ? (alias ?? declared.get(dir)) : undefined;
      if (!local) continue;
      const use = new RegExp(`(?<![\\w.])${local}\\.([A-Za-z_]\\w*)`, 'g');
      lines.forEach((line, index) => {
        if (SKIPPED_LINE.test(line)) return;
        for (const hit of codeOf(line).matchAll(use)) {
          const target = `${dir}\0${hit[1]}`;
          if (!known.has(target)) continue;
          entries.push({ bucket: 'package use', file, line: index + 1, target, name: hit[1] });
        }
      });
    }
  }
  return { entries, inScope: null, note: 'text checker: go.mod and package lines' };
}
