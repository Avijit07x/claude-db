import type { AstNode } from '../../parser.js';
import { addNamed as bind, addSpace, newFacts } from '../binding.js';
import type { ImportFacts } from '../binding.js';
import { moduleOf, stripQuotes } from './specifiers.js';

const DEFAULT = 'default';

const LOADERS = '^(import|require)$';
const LOADER_CALL = /\b(?:import|require)\s*\(/;

function addNamed(
  facts: ImportFacts,
  at: AstNode,
  span: AstNode,
  local: string,
  name: string,
  module: string,
  viaDefault = false,
): void {
  const link = { specifier: module, ...(viaDefault ? { member: DEFAULT } : {}) };
  const imported = { name, link };
  bind(facts, local, imported);
  facts.sites.push({ at, span, imported });
}

function addSpecifier(facts: ImportFacts, specifier: AstNode, module: string): void {
  const at = specifier.field('name');
  const name = at?.text();
  const local = specifier.field('alias')?.text() ?? name;
  if (at && name && local)
    addNamed(facts, at, specifier, local, name === DEFAULT ? local : name, module);
}

export function readImports(root: AstNode): ImportFacts {
  const facts = newFacts();

  for (const clause of root.findAll({ rule: { kind: 'import_clause' } })) {
    const module = moduleOf(clause);
    if (module === undefined) continue;

    for (const part of clause.children()) {
      if (part.kind() === 'identifier') {
        addNamed(facts, part, part, part.text(), part.text(), module, true);
      } else if (part.kind() === 'namespace_import') {
        const local = part.children().find((child) => child.kind() === 'identifier');
        if (local) addSpace(facts, local.text(), { specifier: module });
      } else if (part.kind() === 'named_imports') {
        for (const specifier of part.children()) {
          if (specifier.kind() === 'import_specifier') addSpecifier(facts, specifier, module);
        }
      }
    }
  }
  return facts;
}

export function readLoadedImports(root: AstNode, source: string, facts: ImportFacts): void {
  if (!LOADER_CALL.test(source)) return;
  const calls = root.findAll({
    rule: { kind: 'call_expression', has: { field: 'function', regex: LOADERS } },
  });

  for (const call of calls) {
    const literal = call
      .field('arguments')
      ?.children()
      .find((child) => child.kind() === 'string');
    const parent = call.parent();
    const declarator = parent?.kind() === 'await_expression' ? parent.parent() : parent;
    const pattern = declarator?.kind() === 'variable_declarator' ? declarator.field('name') : null;
    if (!literal || pattern?.kind() !== 'object_pattern') continue;

    const module = stripQuotes(literal.text());
    for (const entry of pattern.children()) {
      if (entry.kind() === 'shorthand_property_identifier_pattern') {
        addNamed(facts, entry, entry, entry.text(), entry.text(), module);
      } else if (entry.kind() === 'pair_pattern') {
        const [key, , value] = entry.children();
        if (key && value) {
          addNamed(facts, value, value, value.text(), key.text(), module);
        }
      }
    }
  }
}
