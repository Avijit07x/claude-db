import { closeSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import type { ModuleResolver } from '../system.js';

export const HEAD_SIZE = 16384;
export const JVM_EXTENSIONS = ['.java', '.kt', '.kts'];
const DEFAULT_PACKAGE = '(default)';
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /\/\/.*$/gm;
const PACKAGE_LINE = /\bpackage\s+([\w.]+)/;

function readHead(path: string): string {
  let handle: number | undefined;
  try {
    handle = openSync(path, 'r');
    const buffer = Buffer.alloc(HEAD_SIZE);
    const read = readSync(handle, buffer, 0, HEAD_SIZE, 0);
    return buffer.toString('utf8', 0, read);
  } catch {
    return '';
  } finally {
    if (handle !== undefined) closeSync(handle);
  }
}

export function packageName(source: string): string {
  const code = source.replace(BLOCK_COMMENT, '').replace(LINE_COMMENT, '');
  return PACKAGE_LINE.exec(code)?.[1] ?? DEFAULT_PACKAGE;
}

export function jvmResolver(
  root: string,
  files: ReadonlySet<string>,
  extensions: readonly string[],
): ModuleResolver {
  const sources = [...files].filter((file) => extensions.some((ext) => file.endsWith(ext)));
  const packages = new Map<string, string>();
  let declared: Set<string> | undefined;

  const unit = (file: string): string => {
    const known = packages.get(file);
    if (known !== undefined) return known;
    const name = packageName(readHead(join(root, file)));
    packages.set(file, name);
    return name;
  };

  const known = (): Set<string> => {
    declared ??= new Set(sources.map(unit));
    return declared;
  };

  return {
    resolve(_from, specifier) {
      const parts = specifier.split('.');
      for (let count = parts.length; count > 0; count -= 1) {
        const name = parts.slice(0, count).join('.');
        if (known().has(name)) return name;
      }
      return known().has(specifier) ? specifier : null;
    },
    unit,
    foreign: () => true,
  };
}
