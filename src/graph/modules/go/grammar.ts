import { sameNode } from '../../ast.js';
import type { Grammar, InContext } from '../binding.js';
import { memberAccess } from '../members.js';
import { shadowing } from '../shadowing.js';

const selecting = memberAccess({
  member: 'selector_expression',
  object: 'operand',
  name: 'field',
  call: 'call_expression',
  callee: 'function',
});
const qualifying = memberAccess({ member: 'qualified_type', object: 'package', name: 'name' });

const BINDING_PARENTS = new Set([
  'parameter_declaration',
  'variadic_parameter_declaration',
  'var_spec',
  'const_spec',
]);
const LISTED_BINDINGS: Record<string, string[]> = {
  short_var_declaration: ['left'],
  range_clause: ['left'],
  type_switch_statement: ['alias'],
};
const OTHER_PARENTS = new Set(['package_clause', 'import_spec', 'labeled_statement']);
const OTHER_SLOTS: Record<string, string[]> = {
  call_expression: ['function'],
  function_declaration: ['name'],
  type_spec: ['name'],
  type_alias: ['name'],
};
const SCOPES = new Set(['function_declaration', 'method_declaration', 'func_literal']);

const isBinding: InContext = (node, parent) => {
  if (BINDING_PARENTS.has(parent.kind())) return node.kind() === 'identifier';
  if (parent.kind() !== 'expression_list') return false;
  const holder = parent.parent();
  return (
    LISTED_BINDINGS[holder?.kind() ?? '']?.some((slot) =>
      sameNode(holder?.field(slot) ?? null, parent),
    ) ?? false
  );
};

const isUse: InContext = (node, parent) =>
  !isBinding(node, parent) &&
  !OTHER_PARENTS.has(parent.kind()) &&
  !(OTHER_SLOTS[parent.kind()]?.some((slot) => sameNode(parent.field(slot), node)) ?? false);

const isMemberObject: InContext = (node, parent) =>
  selecting.isMemberObject(node, parent) || qualifying.isMemberObject(node, parent);

export const grammar: Grammar = {
  kinds: ['identifier', 'type_identifier', 'package_identifier'],
  isUse,
  isLocalUse: isUse,
  isMemberObject,
  memberChain: (parent) =>
    (parent.kind() === 'qualified_type' ? qualifying : selecting).memberChain(parent),
  shadowing: shadowing({
    scopes: SCOPES,
    isBinding,
    runsInside: (scope, child) => sameNode(scope.field('body'), child),
  }),
};
