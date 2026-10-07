import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ALIAS_DEPTH = 3;
const STRUCTURAL = new Set(['defines']);

export const fileTarget = (symbol) => `${symbol.file}\0${symbol.name}`;

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const mentions = (text, name) =>
  new RegExp(`(?<![A-Za-z0-9_])${escapeRegex(name)}(?![A-Za-z0-9_])`).test(text);

function aliasTargets(edges) {
  const targets = new Map();
  for (const edge of edges) {
    if (edge.relation !== 'aliases' || !edge.srcId || !edge.dstId) continue;
    targets.set(edge.srcId, [...(targets.get(edge.srcId) ?? []), edge.dstId]);
  }
  return targets;
}

function throughAliases(id, aliases) {
  const seen = new Set([id]);
  let frontier = [id];
  for (let depth = 0; depth < ALIAS_DEPTH && frontier.length > 0; depth += 1) {
    frontier = frontier.flatMap((at) => aliases.get(at) ?? []).filter((next) => !seen.has(next));
    for (const next of frontier) seen.add(next);
  }
  return [...seen];
}

export function linkedUses(result, targetOf = fileTarget) {
  const byId = new Map(result.symbols.map((symbol) => [symbol.id, symbol]));
  const aliases = aliasTargets(result.edges);
  const linked = new Map();
  for (const edge of result.edges) {
    if (!edge.dstId) continue;
    for (const id of throughAliases(edge.dstId, aliases)) {
      const symbol = byId.get(id);
      if (!symbol) continue;
      const key = `${edge.file}\0${edge.line}\0${targetOf(symbol)}`;
      if (!linked.has(key)) linked.set(key, { edge, symbol });
    }
  }
  return linked;
}

function readLines(path) {
  try {
    return readFileSync(path, 'utf8').split('\n');
  } catch {
    return [];
  }
}

function lineReader(root) {
  const files = new Map();
  return (file, line) => {
    if (!files.has(file)) files.set(file, readLines(join(root, file)));
    return files.get(file)[line - 1] ?? '';
  };
}

export function score({ root, entries, linked }) {
  const lineOf = lineReader(root);
  const buckets = {};
  const expected = new Set();
  const missed = [];
  for (const entry of entries) {
    const key = `${entry.file}\0${entry.line}\0${entry.target}`;
    if (expected.has(key)) continue;
    expected.add(key);
    const tally = (buckets[entry.bucket] ??= { total: 0, linked: 0, covered: 0 });
    tally.total += 1;
    if (linked.has(key)) {
      tally.linked += 1;
      tally.covered += 1;
    } else if (mentions(lineOf(entry.file, entry.line), entry.name)) {
      tally.covered += 1;
    } else {
      missed.push({ ...entry, text: lineOf(entry.file, entry.line).trim() });
    }
  }
  return { buckets, expected, missed };
}

export function extras(linked, expected, inScope) {
  if (!inScope) return null;
  let checked = 0;
  let extra = 0;
  for (const [key, { edge, symbol }] of linked) {
    if (edge.confidence !== 'EXTRACTED' || STRUCTURAL.has(edge.relation) || !inScope(symbol)) {
      continue;
    }
    checked += 1;
    if (!expected.has(key)) extra += 1;
  }
  return { checked, extra };
}
