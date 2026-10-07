import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModuleResolver } from '../system.js';

const RELATIVE = new Set(['crate', 'self', 'super']);
const STANDARD = new Set(['std', 'core', 'alloc', 'proc_macro', 'test']);
const DEPENDENCY_TABLE = /(?:^|\.)(?:dev-|build-)?dependencies(?:\.([\w-]+))?$/;
const ENTRY = /^\s*([\w-]+)\s*(?:=|\.)/gm;
const TARGET = /^(?:src\/bin|tests|examples|benches)\/([^/]+)(?:\.rs|\/main\.rs)$/;

interface Crate {
  root: string;
  dir: string;
  name: string;
  dependencies: Set<string>;
}

const crateName = (name: string): string => name.replace(/-/g, '_');
const dirOf = (file: string): string => file.slice(0, Math.max(file.lastIndexOf('/'), 0));
const joinPath = (...parts: string[]): string => parts.filter(Boolean).join('/');
const stem = (file: string): string => file.slice(file.lastIndexOf('/') + 1).replace(/\.rs$/, '');

const field = (section: string, name: string): string | undefined =>
  new RegExp(`^\\s*${name}\\s*=\\s*"([^"]+)"`, 'm').exec(section)?.[1];

const sectionOf = (text: string, name: string): string =>
  new RegExp(`^\\[${name}\\][ \\t]*$([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, 'm').exec(text)?.[1] ?? '';

function readManifest(root: string, manifest: string): string | undefined {
  try {
    return readFileSync(join(root, manifest), 'utf8');
  } catch {
    return undefined;
  }
}

function dependenciesOf(text: string): Set<string> {
  const found = new Set<string>();
  for (const block of text.split(/^(?=\[)/m)) {
    const header = /^\[([^\]]+)\]/.exec(block)?.[1] ?? '';
    const table = DEPENDENCY_TABLE.exec(header);
    if (!table) continue;
    if (table[1]) found.add(crateName(table[1]));
    else for (const entry of block.matchAll(ENTRY)) found.add(crateName(entry[1] ?? ''));
  }
  return found;
}

function targetsOf(dir: string, files: ReadonlySet<string>): { file: string; dir: string }[] {
  const found: { file: string; dir: string }[] = [];
  for (const file of files) {
    if (dir && !file.startsWith(`${dir}/`)) continue;
    const rel = dir ? file.slice(dir.length + 1) : file;
    const target = TARGET.exec(rel);
    if (!target) continue;
    const owner = rel.startsWith('src/') ? 'src/bin' : (rel.split('/')[0] ?? '');
    found.push({ file, dir: joinPath(dir, owner, target[1] ?? stem(file)) });
  }
  return found;
}

function cratesOf(root: string, files: ReadonlySet<string>): Crate[] {
  const crates: Crate[] = [];

  for (const manifest of files) {
    if (manifest !== 'Cargo.toml' && !manifest.endsWith('/Cargo.toml')) continue;
    const text = readManifest(root, manifest);
    if (text === undefined) continue;
    const base = field(sectionOf(text, 'package'), 'name');
    if (!base) continue;

    const dir = dirOf(manifest);
    const lib = sectionOf(text, 'lib');
    const libRoot = joinPath(dir, field(lib, 'path') ?? 'src/lib.rs');
    const main = joinPath(dir, 'src/main.rs');
    const dependencies = dependenciesOf(text);

    if (files.has(libRoot)) {
      const name = crateName(field(lib, 'name') ?? base);
      crates.push({ root: libRoot, dir: dirOf(libRoot), name, dependencies });
    }
    if (files.has(main)) {
      crates.push({ root: main, dir: dirOf(main), name: crateName(base), dependencies });
    }
    for (const target of targetsOf(dir, files)) {
      crates.push({ root: target.file, dir: target.dir, name: stem(target.file), dependencies });
    }
  }
  return crates;
}

export function rustResolver(root: string, files: ReadonlySet<string>): ModuleResolver {
  const crates = cratesOf(root, files);
  const libs = new Map(
    crates.filter((crate) => crate.root.endsWith('lib.rs')).map((crate) => [crate.name, crate]),
  );

  const crateOf = (file: string): Crate | undefined => {
    const own = crates.find((crate) => crate.root === file);
    if (own) return own;
    const inside = crates.filter((crate) => file.startsWith(`${crate.dir}/`));
    return inside.sort((a, b) => b.dir.length - a.dir.length)[0];
  };

  const pathOf = (file: string, crate: Crate): string[] => {
    if (file === crate.root) return [];
    const parts = file
      .slice(crate.dir.length + 1)
      .replace(/\.rs$/, '')
      .split('/');
    if (parts.at(-1) === 'mod') parts.pop();
    return parts;
  };

  const moduleFile = (crate: Crate, path: string[]): string | null => {
    if (path.length === 0) return crate.root;
    const base = joinPath(crate.dir, ...path);
    return [`${base}.rs`, `${base}/mod.rs`].find((candidate) => files.has(candidate)) ?? null;
  };

  return {
    resolve(from, specifier) {
      let crate = crateOf(from);
      if (!crate) return null;
      const parts = specifier.split('::');
      let path = pathOf(from, crate);
      let at = 0;

      if (parts[0] === 'crate') {
        path = [];
        at = 1;
      } else if (parts[0] === 'self') {
        at = 1;
      } else if (parts[0] === 'super') {
        while (parts[at] === 'super') {
          path = path.slice(0, -1);
          at += 1;
        }
      } else if (!moduleFile(crate, [...path, parts[0] ?? ''])) {
        const external = libs.get(parts[0] ?? '');
        if (!external) return null;
        crate = external;
        path = [];
        at = 1;
      }

      for (const part of parts.slice(at)) {
        path = [...path, part];
        if (!moduleFile(crate, path)) return null;
      }
      return moduleFile(crate, path);
    },

    foreign(from, specifier) {
      const first = specifier.split('::')[0] ?? '';
      return STANDARD.has(first) || (crateOf(from)?.dependencies.has(first) ?? false);
    },

    child(module, segment) {
      const crate = crateOf(module);
      return crate ? moduleFile(crate, [...pathOf(module, crate), segment]) : null;
    },
  };
}

export const isRelative = (specifier: string): boolean =>
  RELATIVE.has(specifier.split('::')[0] ?? '');
