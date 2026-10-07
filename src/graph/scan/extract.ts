import type { CodeSymbol } from '../../types.js';
import { originOf, sameNode } from '../ast.js';
import { callsIn, declarationsIn } from '../languages/index.js';
import type { ListItem, ReferenceRule } from '../languages/rules.js';
import { moduleSystemFor } from '../modules/registry.js';
import { languageHandle, loadParser } from '../parser.js';
import type { AstNode } from '../parser.js';
import { symbolFactory, symbolId } from '../symbols.js';
import type { Extraction, Reference, SourceFile } from '../types.js';
import { container, enclosing, nearestAbove } from './spans.js';
import type { Extent, Span } from './spans.js';

export { symbolId };
export type { Extraction, Reference };

const IDENTIFIER = /^[\w$]+[?!]?$/;

function extractByPattern(file: SourceFile, project: string): Extraction {
  const declare = symbolFactory({
    project,
    path: file.path,
    lang: file.spec.label,
    lines: file.source.split('\n'),
  });
  const symbols: CodeSymbol[] = [];
  const spans: Span[] = [];

  for (const declaration of declarationsIn(file.source)) {
    const symbol = declare(declaration.name, declaration.kind, declaration.line);
    symbols.push(symbol);
    spans.push({ start: declaration.line, end: declaration.line, symbol });
  }

  const references: Reference[] = callsIn(file.source).map((call) => ({
    file: file.path,
    name: call.name,
    relation: 'calls',
    line: call.line,
    from: nearestAbove(call.line, spans),
    weak: true,
  }));

  return { symbols, references };
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
  return text.replace(/^['"`]|['"`]$/g, '').replace(/^[<(:\s]+|[)\s]+$/g, '');
}

const DOTTED = /^(?!this\b|super\b)[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

function qualifiedName(node: AstNode, qualifier: string, name: string): string | null {
  const text = node.field(qualifier)?.text().trim();
  return text && DOTTED.test(text) ? `${text}.${name}` : null;
}

function isDeclarationSite(node: AstNode, sites: string[] | undefined): boolean {
  if (!sites) return false;
  const parent = node.parent();
  if (!parent || !sites.includes(parent.kind())) return false;
  const declared = parent.field('name');
  return !declared || sameNode(declared, node);
}

function selected(child: AstNode, item: ListItem): AstNode | null {
  if (item.field) return child.field(item.field);
  if (!item.select) return child;
  const kinds = item.select;
  return child.children().find((inner) => kinds.includes(inner.kind())) ?? null;
}

function listedTargets(node: AstNode, items: ListItem[]): AstNode[] {
  return node.children().flatMap((child) => {
    const item = items.find((candidate) => candidate.kind === child.kind());
    const target = item && selected(child, item);
    return target ? [target] : [];
  });
}

function targetsOf(rule: ReferenceRule, matched: AstNode): AstNode[] {
  if (rule.listOf) return listedTargets(matched, rule.listOf);
  return rule.field.length === 0 ? namedTargets(matched) : [matched];
}

function namedTargets(node: AstNode): AstNode[] {
  if (!/\s/.test(node.text().trim())) return [node];

  const inner: AstNode[] = [];
  for (const kind of ['type_identifier', 'identifier']) {
    try {
      inner.push(...node.findAll({ rule: { kind } }));
    } catch {}
  }
  return inner.length > 0 ? inner : [node];
}

function nodesByKind(root: AstNode, kinds: string[]): Map<string, AstNode[]> {
  const grouped = new Map<string, AstNode[]>();
  const wanted = [...new Set(kinds)].map((kind) => ({ kind }));
  for (const node of root.findAll({ rule: { any: wanted } })) {
    const kind = node.kind();
    const bucket = grouped.get(kind);
    if (bucket) bucket.push(node);
    else grouped.set(kind, [node]);
  }
  return grouped;
}

export function extractFile(file: SourceFile, project: string): Extraction {
  if (file.spec.basic) return extractByPattern(file, project);

  const parser = loadParser();
  const root = parser.parse(languageHandle(parser, file.spec.id), file.source).root();
  const declare = symbolFactory({
    project,
    path: file.path,
    lang: file.spec.label,
    lines: file.source.split('\n'),
  });
  const symbols: CodeSymbol[] = [];
  const spans: Extent[] = [];
  const system = moduleSystemFor(file.spec.label);
  const ruleKinds = [...file.spec.definitions, ...file.spec.references].map((rule) => rule.kind);
  const nodes = nodesByKind(root, [...ruleKinds, ...(system?.nodeKinds ?? [])]);

  for (const rule of file.spec.definitions) {
    for (const node of nodes.get(rule.kind) ?? []) {
      const named = rule.nameKind
        ? (node.children().find((child) => child.kind() === rule.nameKind) ?? null)
        : resolveField(node, rule.field);
      const name = named?.text();
      if (!named || !name || !IDENTIFIER.test(name)) continue;

      const member = rule.memberOf?.includes(node.parent()?.kind() ?? '');
      const symbol = declare(name, member ? 'method' : rule.symbol, named.range().start.line + 1);
      symbols.push(symbol);
      const { start, end } = node.range();
      spans.push({
        start: start.line + 1,
        end: end.line + 1,
        from: start.index,
        to: end.index,
        symbol,
      });
    }
  }

  const references: Reference[] = [];

  for (const span of spans) {
    const owner = container(span, spans);
    if (!owner) continue;
    references.push({
      file: file.path,
      name: span.symbol.name,
      relation: 'defines',
      line: span.start,
      from: owner,
      to: span.symbol.id,
    });
  }

  for (const rule of file.spec.references) {
    for (const node of nodes.get(rule.kind) ?? []) {
      const matched = rule.field.length === 0 ? node : resolveField(node, rule.field);
      if (!matched) continue;
      if (rule.parents && !rule.parents.includes(node.parent()?.kind() ?? '')) continue;
      if (rule.objectKinds && !rule.objectKinds.includes(node.field('object')?.kind() ?? '')) {
        continue;
      }

      for (const target of targetsOf(rule, matched)) {
        const raw = target.text();
        if (!raw) continue;

        const written = unquote(raw.trim());
        if (!written || /\s/.test(written)) continue;
        const name = rule.qualifier ? qualifiedName(node, rule.qualifier, written) : written;
        if (!name) continue;
        if (rule.relation === 'references' && name.includes('.')) continue;
        if (rule.namePattern && !rule.namePattern.test(name)) continue;
        if (isDeclarationSite(node, rule.excludeParents)) continue;

        const line = target.range().start.line + 1;
        references.push({
          file: file.path,
          name,
          relation: rule.relation,
          line,
          from: enclosing(line, spans),
          origin: originOf(node),
        });
      }
    }
  }

  if (!system) return { symbols, references };

  const facts = system.read({
    root,
    nodes,
    file,
    declare,
    symbols,
    references,
    owner: (line) => enclosing(line, spans),
  });
  return { symbols: [...symbols, ...facts.added], references: facts.references };
}
