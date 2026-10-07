import { escapeRegex, readAll, withoutComments } from './text.mjs';
import { isTopLevel } from './tools.mjs';

const SOURCE = /\.(kt|kts|java)$/;
const KOTLIN = /\.(kt|kts)$/;
const PACKAGE_LINE = /^\s*package\s+([\w.]+)/m;
const IMPORT_LINE = /^\s*import\s+([\w.]+)(\.\*)?(?:\s+as\s+(\w+))?\s*$/;
const HEADER_LINE = /^\s*(import|package)\b/;
const CLASS_NAME = /^[A-Z]/;
const DEFAULT_PACKAGE = '(default)';

const usePattern = (word) => new RegExp(`(?<![\\w.@])${escapeRegex(word)}(?!\\w)(?!\\s*:(?!:))`);

function declaredByPackage(symbols, packageOf) {
  const declared = new Map();
  for (const symbol of symbols) {
    if (!/\.(kt|java)$/.test(symbol.file) || !isTopLevel(symbol)) continue;
    const key = `${packageOf.get(symbol.file)}\0${symbol.name}`;
    declared.set(key, [...(declared.get(key) ?? []), symbol]);
  }
  return declared;
}

function importTarget(segments, declared) {
  for (let cut = segments.length - 1; cut >= 0; cut -= 1) {
    const hits = declared.get(`${segments.slice(0, cut).join('.')}\0${segments[cut]}`);
    if (hits) return { symbol: hits[0], name: segments[cut] };
  }
  return null;
}

const entryFor = (bucket, file, index, symbol) => ({
  bucket,
  file,
  line: index + 1,
  target: `${symbol.file}\0${symbol.name}`,
  name: symbol.name,
});

function importsOf(file, lines, declared) {
  const entries = [];
  const local = new Map();
  lines.forEach((line, index) => {
    const match = IMPORT_LINE.exec(line);
    if (!match || match[2]) return;
    const segments = match[1].split('.');
    const found = importTarget(segments, declared);
    if (!found) return;
    entries.push(entryFor('import', file, index, found.symbol));
    if (found.name === segments.at(-1)) local.set(match[3] ?? found.name, found.symbol);
  });
  return { entries, local };
}

function samePackageNames({ file, pkg, declared, local, sameFile }) {
  const names = new Map();
  for (const [key, hits] of declared) {
    const [owner, name] = key.split('\0');
    const visible = owner === pkg && hits.length === 1 && hits[0].file !== file;
    if (visible && CLASS_NAME.test(name) && !local.has(name) && !sameFile.has(name)) {
      names.set(name, hits[0]);
    }
  }
  return names;
}

function usesOf(file, lines, names, bucket) {
  const entries = [];
  for (const [word, symbol] of names) {
    const pattern = usePattern(word);
    lines.forEach((line, index) => {
      if (!HEADER_LINE.test(line) && pattern.test(line)) {
        entries.push(entryFor(bucket, file, index, symbol));
      }
    });
  }
  return entries;
}

export function expected({ root, files, result }) {
  const sources = readAll(
    root,
    files.filter((file) => SOURCE.test(file)),
  );
  const stripped = new Map([...sources].map(([file, text]) => [file, withoutComments(text)]));
  const packageOf = new Map(
    [...stripped].map(([file, text]) => [file, PACKAGE_LINE.exec(text)?.[1] ?? DEFAULT_PACKAGE]),
  );
  const declared = declaredByPackage(result.symbols, packageOf);

  const entries = [];
  for (const [file, text] of stripped) {
    if (!KOTLIN.test(file)) continue;
    const lines = text.split('\n');
    const sameFile = new Set(result.symbols.filter((s) => s.file === file).map((s) => s.name));
    const imports = importsOf(file, lines, declared);
    const imported = new Map([...imports.local].filter(([name]) => !sameFile.has(name)));
    const pkg = packageOf.get(file);
    const local = imports.local;
    entries.push(
      ...imports.entries,
      ...usesOf(file, lines, imported, 'imported'),
      ...usesOf(file, lines, samePackageNames({ file, pkg, declared, local, sameFile }), 'package'),
    );
  }
  return { entries, inScope: null, note: 'text checker: package and import lines' };
}
