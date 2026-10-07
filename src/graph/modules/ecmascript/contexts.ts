import { sameNode } from '../../ast.js';
import type { AstNode } from '../../parser.js';
import type { InContext } from '../binding.js';
import { memberAccess } from '../members.js';
import { moduleOf } from './specifiers.js';

const propertyOf = (member: AstNode): string => member.children().at(-1)?.text() ?? '';

const members = memberAccess({
  member: 'member_expression',
  object: 'object',
  name: propertyOf,
  call: 'call_expression',
  callee: 'function',
});

export const { isReceiverOfCall, isMemberObject, memberChain } = members;

const NON_USE_PARENTS = new Set([
  'import_specifier',
  'import_clause',
  'namespace_import',
  'formal_parameters',
  'pair_pattern',
  'jsx_opening_element',
  'jsx_self_closing_element',
  'jsx_closing_element',
]);
const VALUE_PARENTS = new Set([
  'arguments',
  'member_expression',
  'binary_expression',
  'unary_expression',
  'ternary_expression',
  'parenthesized_expression',
  'await_expression',
  'as_expression',
  'satisfies_expression',
  'non_null_expression',
  'spread_element',
  'template_substitution',
  'jsx_expression',
  'return_statement',
  'expression_statement',
  'array',
  'pair',
  'type_query',
]);
const DECLARING_SLOTS = ['function', 'constructor', 'name', 'pattern', 'parameter', 'alias'];
const DEFAULT_PARENTS = new Set([
  'required_parameter',
  'optional_parameter',
  'assignment_pattern',
  'object_assignment_pattern',
]);
const DEFAULT_SLOTS = ['value', 'right'];

export const isLocalExport: InContext = (node, parent) =>
  parent.kind() === 'export_specifier' &&
  moduleOf(parent) === undefined &&
  !sameNode(parent.field('alias'), node);

export const isUse: InContext = (node, parent) => {
  const kind = parent.kind();
  if (NON_USE_PARENTS.has(kind)) return false;
  if (!VALUE_PARENTS.has(kind) && DECLARING_SLOTS.some((s) => sameNode(parent.field(s), node))) {
    return false;
  }
  return !isReceiverOfCall(parent);
};

const isTypeQuery: InContext = (_node, parent) => parent.kind() === 'type_query';

const isInstanceofTarget: InContext = (node, parent) =>
  parent.kind() === 'binary_expression' &&
  parent.field('operator')?.text() === 'instanceof' &&
  sameNode(parent.field('right'), node);

const isDefaultValue: InContext = (node, parent) =>
  DEFAULT_PARENTS.has(parent.kind()) &&
  DEFAULT_SLOTS.some((slot) => sameNode(parent.field(slot), node));

const isTopLevelCopy: InContext = (node, parent) => {
  if (parent.kind() !== 'variable_declarator' || !sameNode(parent.field('value'), node)) {
    return false;
  }
  const owner = parent.parent()?.parent();
  const top = owner?.kind() === 'export_statement' ? owner.parent() : owner;
  return top?.kind() === 'program';
};

const isInstantiated: InContext = (_node, parent) => parent.kind() === 'instantiation_expression';

const LOCAL_CONTEXTS = [
  isDefaultValue,
  isLocalExport,
  isTypeQuery,
  isInstanceofTarget,
  isTopLevelCopy,
  isInstantiated,
];

export const isLocalContext: InContext = (node, parent) =>
  LOCAL_CONTEXTS.some((inContext) => inContext(node, parent));
