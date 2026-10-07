import { sameNode } from '../../ast.js';
import type { AstNode } from '../../parser.js';
import type { Grammar, InContext } from '../binding.js';
import { memberAccess } from '../members.js';
import { shadowing } from '../shadowing.js';

const valuePath = memberAccess({
  member: 'scoped_identifier',
  object: 'path',
  name: 'name',
  call: 'call_expression',
  callee: 'function',
});
const typePath = memberAccess({ member: 'scoped_type_identifier', object: 'path', name: 'name' });

const BINDING_PARENTS = new Set([
  'parameter',
  'let_declaration',
  'closure_parameters',
  'for_expression',
  'tuple_pattern',
  'reference_pattern',
  'mut_pattern',
  'slice_pattern',
  'or_pattern',
  'captured_pattern',
  'field_pattern',
  'tuple_struct_pattern',
  'match_pattern',
  'let_condition',
]);
const EXPRESSION_SLOTS = ['value', 'type', 'body', 'alternative', 'condition'];
const USE_PARTS = new Set([
  'scoped_identifier',
  'scoped_use_list',
  'use_list',
  'use_as_clause',
  'use_wildcard',
]);
const OTHER_SLOTS: Record<string, string[]> = {
  call_expression: ['function'],
  macro_invocation: ['macro'],
  function_item: ['name'],
  struct_item: ['name'],
  enum_item: ['name'],
  trait_item: ['name'],
  type_item: ['name'],
  mod_item: ['name'],
  const_item: ['name'],
  static_item: ['name'],
  union_item: ['name'],
  enum_variant: ['name'],
  type_parameter: ['name'],
};
const SCOPES = new Set(['function_item', 'closure_expression']);
const ITEMS = new Set(['function_item', 'struct_item', 'enum_item', 'trait_item', 'type_item']);

const isBinding: InContext = (node, parent) =>
  BINDING_PARENTS.has(parent.kind()) &&
  !EXPRESSION_SLOTS.some((slot) => sameNode(parent.field(slot), node));

function inUse(parent: AstNode): boolean {
  let up: AstNode | null = parent;
  while (up && USE_PARTS.has(up.kind())) up = up.parent();
  return up?.kind() === 'use_declaration';
}

const isUse: InContext = (node, parent) =>
  !isBinding(node, parent) &&
  !inUse(parent) &&
  !(OTHER_SLOTS[parent.kind()]?.some((slot) => sameNode(parent.field(slot), node)) ?? false);

const isMemberObject: InContext = (node, parent) =>
  valuePath.isMemberObject(node, parent) || typePath.isMemberObject(node, parent);

function localNames(root: AstNode): Set<string> {
  const names = new Set<string>();
  const visit = (scope: AstNode): void => {
    for (const item of scope.children()) {
      const name = ITEMS.has(item.kind()) && item.field('name');
      if (name) names.add(name.text());
      if (item.kind() === 'mod_item') {
        const body = item.field('body');
        if (body) visit(body);
      }
    }
  };
  visit(root);
  return names;
}

export const grammar: Grammar = {
  kinds: ['identifier', 'type_identifier'],
  isUse,
  isLocalUse: isUse,
  isMemberObject,
  memberChain: (parent) =>
    (parent.kind() === 'scoped_type_identifier' ? typePath : valuePath).memberChain(parent),
  localNames,
  shadowing: shadowing({
    scopes: SCOPES,
    isBinding,
    runsInside: (scope, child) => sameNode(scope.field('body'), child),
  }),
};
