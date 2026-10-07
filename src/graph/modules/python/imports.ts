import { sameNode } from '../../ast.js';
import type { AstNode } from '../../parser.js';
import { addNamed, addSpace, newFacts } from '../binding.js';
import type { ImportFacts, Lines } from '../binding.js';

const IMPORTS = /\bimport\b/;
const STATEMENTS = [{ kind: 'import_statement' }, { kind: 'import_from_statement' }];
const SCOPES = new Set(['function_definition', 'class_definition']);
const EVERYTHING = '*';

const compact = (node: AstNode): string => node.text().replace(/\s+/g, '');

function enclosing(statement: AstNode): Lines | undefined {
  for (let up = statement.parent(); up; up = up.parent()) {
    if (!SCOPES.has(up.kind())) continue;
    const { start, end } = up.range();
    return { start: start.line + 1, end: end.line + 1 };
  }
  return undefined;
}

function readImport(facts: ImportFacts, statement: AstNode): void {
  const within = enclosing(statement);
  const space = (local: string, specifier: string): void =>
    addSpace(facts, local, { specifier, ...(within ? { within } : {}) });

  for (const part of statement.children()) {
    if (part.kind() === 'dotted_name') {
      const head = compact(part).split('.')[0] ?? '';
      space(head, head);
    } else if (part.kind() === 'aliased_import') {
      const module = part.field('name');
      const alias = part.field('alias');
      if (module && alias) space(alias.text(), compact(module));
    }
  }
}

function readFrom(facts: ImportFacts, statement: AstNode): void {
  const source = statement.field('module_name');
  if (!source) return;
  const specifier = compact(source);
  const within = enclosing(statement);
  const scope = within ? { within } : {};

  const site = (at: AstNode, span: AstNode, name: string, local: string): void => {
    addNamed(facts, local, { name, link: { specifier }, ...scope });
    const link = { specifier, ...(within ? {} : { exported: local }) };
    facts.sites.push({ at, span, imported: { name, link } });
  };

  for (const part of statement.children()) {
    if (part.kind() === 'wildcard_import') {
      const link = { specifier, exported: EVERYTHING };
      facts.sites.push({ at: part, span: part, imported: { name: EVERYTHING, link } });
    } else if (part.kind() === 'dotted_name' && !sameNode(source, part)) {
      site(part, part, compact(part), compact(part));
    } else if (part.kind() === 'aliased_import') {
      const name = part.field('name');
      const alias = part.field('alias');
      if (name && alias) site(name, part, compact(name), alias.text());
    }
  }
}

export function readImports(root: AstNode, source: string): ImportFacts {
  const facts = newFacts();
  if (!IMPORTS.test(source)) return facts;

  for (const statement of root.findAll({ rule: { any: STATEMENTS } })) {
    if (statement.kind() === 'import_statement') readImport(facts, statement);
    else readFrom(facts, statement);
  }
  return facts;
}
