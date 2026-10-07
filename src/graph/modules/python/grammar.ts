import { sameNode } from '../../ast.js';
import type { AstNode } from '../../parser.js';
import type { Grammar, InContext } from '../binding.js';
import { memberAccess } from '../members.js';
import { shadowing } from '../shadowing.js';

const members = memberAccess({
  member: 'attribute',
  object: 'object',
  name: 'attribute',
  call: 'call',
  callee: 'function',
});

const BINDING_PARENTS = new Set([
  'parameters',
  'lambda_parameters',
  'typed_parameter',
  'list_splat_pattern',
  'dictionary_splat_pattern',
  'pattern_list',
  'tuple_pattern',
  'list_pattern',
  'as_pattern_target',
]);
const BINDING_SLOTS: Record<string, string[]> = {
  assignment: ['left'],
  augmented_assignment: ['left'],
  for_statement: ['left'],
  for_in_clause: ['left'],
  type_alias_statement: ['left'],
  named_expression: ['name'],
  function_definition: ['name'],
  class_definition: ['name'],
  default_parameter: ['name'],
  typed_default_parameter: ['name'],
};
const OTHER_PARENTS = new Set([
  'import_statement',
  'import_from_statement',
  'aliased_import',
  'dotted_name',
  'relative_import',
  'global_statement',
  'nonlocal_statement',
]);
const OTHER_SLOTS: Record<string, string[]> = {
  attribute: ['attribute'],
  call: ['function'],
  keyword_argument: ['name'],
};
const RELEASING = new Set(['global_statement', 'nonlocal_statement']);
const SCOPES = new Set([
  'function_definition',
  'lambda',
  'list_comprehension',
  'set_comprehension',
  'dictionary_comprehension',
  'generator_expression',
]);
const DEFINITIONS = new Set(['function_definition', 'class_definition']);

const occupies = (table: Record<string, string[]>, node: AstNode, parent: AstNode): boolean =>
  table[parent.kind()]?.some((slot) => sameNode(parent.field(slot), node)) ?? false;

const isBinding: InContext = (node, parent) =>
  BINDING_PARENTS.has(parent.kind()) || occupies(BINDING_SLOTS, node, parent);

const isBaseClass: InContext = (_node, parent) =>
  parent.kind() === 'argument_list' && parent.parent()?.kind() === 'class_definition';

const isUse: InContext = (node, parent) =>
  !isBinding(node, parent) &&
  !OTHER_PARENTS.has(parent.kind()) &&
  !occupies(OTHER_SLOTS, node, parent) &&
  !isBaseClass(node, parent);

function scopeOf(node: AstNode, parent: AstNode): AstNode | null {
  const defined = DEFINITIONS.has(parent.kind()) && sameNode(parent.field('name'), node);
  for (let up = defined ? parent.parent() : parent; up; up = up.parent()) {
    if (SCOPES.has(up.kind())) return up;
  }
  return null;
}

const runsInside = (scope: AstNode, child: AstNode): boolean =>
  scope.kind().endsWith('comprehension') ||
  scope.kind() === 'generator_expression' ||
  sameNode(scope.field('body'), child);

function localNames(root: AstNode): Set<string> {
  const names = new Set<string>();
  for (const statement of root.children()) {
    const definition =
      statement.kind() === 'decorated_definition' ? statement.field('definition') : statement;
    const name = definition && DEFINITIONS.has(definition.kind()) && definition.field('name');
    if (name) names.add(name.text());
  }
  return names;
}

export const grammar: Grammar = {
  kinds: ['identifier'],
  isUse,
  isLocalUse: isUse,
  isMemberObject: members.isMemberObject,
  memberChain: members.memberChain,
  localNames,
  shadowing: shadowing({
    scopes: SCOPES,
    isBinding,
    isReleased: (_node, parent) => RELEASING.has(parent.kind()),
    scopeOf,
    runsInside,
  }),
};
