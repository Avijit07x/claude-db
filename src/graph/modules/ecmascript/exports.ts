import type { CodeSymbol } from '../../../types.js';
import { originOf } from '../../ast.js';
import type { AstNode } from '../../parser.js';
import type { Declare } from '../../symbols.js';
import type { Reference, SourceFile } from '../../types.js';
import { moduleOf } from './specifiers.js';

const EXPORTS = /\bexport\b/;
const DEFAULT = 'default';
const EVERYTHING = '*';

export interface ExportFacts {
  symbols: CodeSymbol[];
  references: Reference[];
}

interface Site {
  file: string;
  declare: Declare;
  found: ExportFacts;
}

function alias(
  site: Site,
  publicName: string,
  target: string | undefined,
  at: AstNode,
  module?: string,
) {
  const line = at.range().start.line + 1;
  const symbol = site.declare(publicName, 'const', line);
  site.found.symbols.push(symbol);
  if (target === undefined) return;
  site.found.references.push({
    file: site.file,
    name: target,
    relation: 'aliases',
    line,
    from: symbol,
    origin: originOf(at),
    ...(module === undefined ? {} : { link: { specifier: module } }),
  });
}

function link(
  site: Site,
  at: AstNode,
  module: string,
  exported: string,
  namespace = false,
): Reference {
  return {
    file: site.file,
    name: EVERYTHING,
    relation: 'imports',
    line: at.range().start.line + 1,
    from: null,
    origin: originOf(at),
    link: { specifier: module, exported, ...(namespace ? { namespace } : {}) },
  };
}

function readSpecifier(site: Site, specifier: AstNode, module: string | undefined): void {
  const original = specifier.field('name')?.text();
  if (!original) return;
  const publicName = specifier.field('alias')?.text() ?? original;

  if (module !== undefined) {
    site.found.references.push({
      file: site.file,
      name: original,
      relation: 'imports',
      line: specifier.range().start.line + 1,
      from: null,
      origin: originOf(specifier),
      link: { specifier: module, exported: publicName },
    });
  }
  if (publicName !== original) alias(site, publicName, original, specifier, module);
}

function readDefault(site: Site, statement: AstNode): void {
  const target = statement.field('declaration') ?? statement.field('value');
  const name = target?.kind() === 'identifier' ? target.text() : target?.field('name')?.text();
  alias(site, DEFAULT, name, statement);
}

function readStatement(site: Site, statement: AstNode): void {
  const parts = statement.children();
  if (parts.some((part) => part.kind() === DEFAULT)) return readDefault(site, statement);

  const module = moduleOf(statement);
  for (const part of parts) {
    if (part.kind() === 'export_clause') {
      for (const child of part.children()) {
        if (child.kind() === 'export_specifier') readSpecifier(site, child, module);
      }
    } else if (part.kind() === 'namespace_export' && module !== undefined) {
      const name = part
        .children()
        .find((child) => child.kind() === 'identifier')
        ?.text();
      if (name) site.found.references.push(link(site, part, module, name, true));
    } else if (part.kind() === EVERYTHING && module !== undefined) {
      site.found.references.push(link(site, statement, module, EVERYTHING));
    }
  }
}

export function readExports(root: AstNode, file: SourceFile, declare: Declare): ExportFacts {
  const found: ExportFacts = { symbols: [], references: [] };
  if (!EXPORTS.test(file.source)) return found;

  const site: Site = { file: file.path, declare, found };
  for (const statement of root.findAll({ rule: { kind: 'export_statement' } })) {
    readStatement(site, statement);
  }
  return found;
}
