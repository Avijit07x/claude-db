import type { AstNode } from '../../parser.js';
import { scopeLookup } from '../jvm/receivers.js';
import type { FindDeclared, Scoped } from '../jvm/receivers.js';

export interface Declared extends Scoped {
  type: AstNode | null;
  array: boolean;
  holder: AstNode | null;
}

export const DECLARATION_KINDS = [
  'field_declaration',
  'constant_declaration',
  'local_variable_declaration',
  'formal_parameter',
  'spread_parameter',
  'catch_formal_parameter',
  'enhanced_for_statement',
  'resource',
  'instanceof_expression',
];
const FIELDS = new Set(['field_declaration', 'constant_declaration']);
const AFTER_DECLARATION = new Set([
  'local_variable_declaration',
  'instanceof_expression',
  'resource',
]);
const TYPE_KINDS = new Set([
  'type_identifier',
  'scoped_type_identifier',
  'generic_type',
  'array_type',
  'integral_type',
  'floating_point_type',
  'boolean_type',
  'annotated_type',
]);
const BLOCKS = new Set([
  'block',
  'constructor_body',
  'switch_block_statement_group',
  'lambda_expression',
]);

function enclosingBlock(node: AstNode): AstNode | null {
  for (let at = node.parent(); at; at = at.parent()) if (BLOCKS.has(at.kind())) return at;
  return null;
}

function scopeOf(node: AstNode): AstNode | null {
  const kind = node.kind();
  if (kind === 'formal_parameter' || kind === 'spread_parameter')
    return node.parent()?.parent() ?? null;
  if (kind === 'catch_formal_parameter' || kind === 'resource') {
    const holder = node.parent();
    return kind === 'resource' ? (holder?.parent() ?? null) : holder;
  }
  if (kind === 'enhanced_for_statement') return node;
  if (kind === 'instanceof_expression') return enclosingBlock(node);
  return node.parent();
}

function caughtType(node: AstNode): AstNode | null {
  const types = node
    .children()
    .find((child) => child.kind() === 'catch_type')
    ?.children()
    .filter((child) => TYPE_KINDS.has(child.kind()));
  return types?.length === 1 ? (types[0] ?? null) : null;
}

function typeOf(node: AstNode): AstNode | null {
  const kind = node.kind();
  if (kind === 'instanceof_expression') return node.field('right');
  if (kind === 'catch_formal_parameter') return caughtType(node);
  if (kind === 'spread_parameter') {
    return node.children().find((child) => TYPE_KINDS.has(child.kind())) ?? null;
  }
  return node.field('type');
}

function namesOf(node: AstNode): { name: AstNode; holder: AstNode }[] {
  const direct = node.field('name');
  if (direct) return [{ name: direct, holder: node }];
  return node
    .children()
    .filter((child) => child.kind() === 'variable_declarator')
    .flatMap((holder) => {
      const name = holder.field('name');
      return name ? [{ name, holder }] : [];
    });
}

function declaredBy(node: AstNode): Declared[] {
  const scope = scopeOf(node);
  if (!scope) return [];
  const kind = node.kind();
  const field = FIELDS.has(kind);
  const { start, end } = scope.range();
  const at = AFTER_DECLARATION.has(kind) ? node.range().start.index : start.index;
  const type = typeOf(node);
  return namesOf(node).map(({ name, holder }) => ({
    name: name.text(),
    from: start.index,
    to: end.index,
    at,
    field,
    type,
    array: kind === 'spread_parameter' || holder.field('dimensions') !== null,
    holder: holder === node ? null : holder,
  }));
}

export function declarationsIn(nodes: ReadonlyMap<string, AstNode[]>): FindDeclared<Declared> {
  return scopeLookup(
    DECLARATION_KINDS.flatMap((kind) => nodes.get(kind) ?? []).flatMap(declaredBy),
  );
}
