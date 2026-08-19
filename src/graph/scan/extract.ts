import type { CodeSymbol, EdgeRelation } from '../../types.js';
import { observationId } from '../../capture/identity.js';
import { redact } from '../../capture/turn-extractor.js';
import { languageHandle, loadParser } from '../parser.js';
import type { AstNode } from '../parser.js';
import type { SourceFile } from './files.js';

export interface Reference {
  file: string;
  name: string;
  relation: EdgeRelation;
  line: number;
  from: CodeSymbol | null;
}

export interface Extraction {
  symbols: CodeSymbol[];
  references: Reference[];
}

interface Span {
  start: number;
  end: number;
  symbol: CodeSymbol;
}

const CALLABLE = new Set(['function', 'method', 'class']);
const IDENTIFIER = /^[\w$]+$/;

export function symbolId(project: string, file: string, name: string, kind: string): string {
  return observationId('graph', 0, `${project}\0${file}\0${name}\0${kind}`);
}

function resolveField(node: AstNode, path: string[]): AstNode | null {
  let current: AstNode | null = node;
  for (const name of path) {
    if (!current) return null;
    current = current.field(name);
  }
  return current;
}

function unquote(text: string): string {
  return text.replace(/^['"`]|['"`]$/g, '');
}

function enclosing(line: number, spans: Span[]): CodeSymbol | null {
  let best: Span | null = null;
  let fallback: Span | null = null;
  for (const span of spans) {
    if (line < span.start || line > span.end) continue;
    const width = span.end - span.start;
    if (CALLABLE.has(span.symbol.kind)) {
      if (!best || width < best.end - best.start) best = span;
      continue;
    }
    if (span.start === line) continue;
    if (!fallback || width < fallback.end - fallback.start) fallback = span;
  }
  return (best ?? fallback)?.symbol ?? null;
}

export function extractFile(file: SourceFile, project: string): Extraction {
  const parser = loadParser();
  const root = parser.parse(languageHandle(parser, file.spec.id), file.source).root();
  const lines = file.source.split('\n');

  const symbols: CodeSymbol[] = [];
  const spans: Span[] = [];

  for (const rule of file.spec.definitions) {
    for (const node of root.findAll({ rule: { kind: rule.kind } })) {
      const named = resolveField(node, rule.field);
      const name = named?.text();
      if (!named || !name || !IDENTIFIER.test(name)) continue;

      const line = named.range().start.line + 1;
      const symbol: CodeSymbol = {
        id: symbolId(project, file.path, name, rule.symbol),
        project,
        name,
        kind: rule.symbol,
        file: file.path,
        line,
        lang: file.spec.label,
        signature: redact((lines[line - 1] ?? '').trim()).slice(0, 200),
      };
      symbols.push(symbol);
      spans.push({
        start: node.range().start.line + 1,
        end: node.range().end.line + 1,
        symbol,
      });
    }
  }

  const references: Reference[] = [];

  for (const span of spans) {
    const owner = enclosing(
      span.start,
      spans.filter((other) => other.symbol.id !== span.symbol.id),
    );
    if (!owner) continue;
    references.push({
      file: file.path,
      name: span.symbol.name,
      relation: 'defines',
      line: span.start,
      from: owner,
    });
  }

  for (const rule of file.spec.references) {
    for (const node of root.findAll({ rule: { kind: rule.kind } })) {
      const target = rule.field.length === 0 ? node : resolveField(node, rule.field);
      const raw = target?.text();
      if (!target || !raw) continue;

      const name = unquote(raw.trim());
      if (!name || /\s/.test(name)) continue;
      if (rule.relation === 'references' && name.includes('.')) continue;

      const line = target.range().start.line + 1;
      references.push({
        file: file.path,
        name,
        relation: rule.relation,
        line,
        from: enclosing(line, spans),
      });
    }
  }

  return { symbols, references };
}
