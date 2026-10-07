import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { extractFile } from '../../dist/graph/scan/extract.js';
import { resolveEdges } from '../../dist/graph/scan/resolve.js';
import { createModuleContext } from '../../dist/graph/modules/registry.js';
import { languageFor } from '../../dist/graph/languages/index.js';

export function scan(files, { root = '/p', extra = [] } = {}) {
  const parsed = Object.entries(files).map(([path, source]) =>
    extractFile({ path, spec: languageFor(path), source, hash: 'h' }, '/p'),
  );
  const symbols = parsed.flatMap((entry) => entry.symbols);
  const references = parsed.flatMap((entry) => entry.references);
  const known = new Set([...Object.keys(files), ...extra]);
  return {
    symbols,
    edges: resolveEdges('/p', symbols, references, createModuleContext(root, known)),
  };
}

export function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'graph-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const sources = Object.fromEntries(
    Object.entries(files).filter(([path]) => languageFor(path) !== null),
  );
  const result = scan(sources, { root, extra: Object.keys(files) });
  return { root, ...result, done: () => rmSync(root, { recursive: true, force: true }) };
}

export const importsOf = (edges, name) =>
  edges.filter((edge) => edge.relation === 'imports' && edge.dstName === name && edge.srcId === '');

export const symbolNamed = (symbols, name, file) =>
  symbols.find((symbol) => symbol.name === name && (file === undefined || symbol.file === file));

export const edgesTo = (edges, symbol, relation) =>
  edges.filter((edge) => edge.dstId === symbol?.id && (!relation || edge.relation === relation));
