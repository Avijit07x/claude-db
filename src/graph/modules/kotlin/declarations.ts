import type { AstNode } from '../../parser.js';
import { scopeLookup } from '../jvm/receivers.js';
import type { FindDeclared, Scoped } from '../jvm/receivers.js';

export interface Declared extends Scoped {
  type: AstNode | null;
  value: AstNode | null;
}

export const DECLARATION_KINDS = [
  'variable_declaration',
  'parameter',
  'class_parameter',
  'catch_block',
];
const NAME = 'simple_identifier';
const TYPES = new Set(['user_type', 'nullable_type']);
const MEMBER_BODIES = new Set(['class_body', 'enum_class_body']);

const childOf = (node: AstNode, kinds: ReadonlySet<string>): AstNode | null =>
  node.children().find((child) => kinds.has(child.kind())) ?? null;

const nameOf = (node: AstNode): AstNode | null =>
  node.children().find((child) => child.kind() === NAME) ?? null;

function valueOf(property: AstNode): AstNode | null {
  const parts = property.children();
  const equals = parts.findIndex((part) => part.kind() === '=');
  return equals < 0 ? null : (parts[equals + 1] ?? null);
}

interface Place {
  scope: AstNode;
  field: boolean;
  afterDeclaration: boolean;
  property: AstNode | null;
}

const local = (scope: AstNode): Place => ({
  scope,
  field: false,
  afterDeclaration: false,
  property: null,
});

function variablePlace(node: AstNode): Place | null {
  const holder = node.parent();
  const kind = holder?.kind();
  if (!holder) return null;
  if (kind === 'for_statement') return local(holder);
  if (kind === 'lambda_parameters') {
    const lambda = holder.parent();
    return lambda ? local(lambda) : null;
  }
  const scope = kind === 'property_declaration' ? holder.parent() : null;
  if (!scope) return null;
  const field = MEMBER_BODIES.has(scope.kind());
  return { scope, field, afterDeclaration: scope.kind() === 'statements', property: holder };
}

function placeOf(node: AstNode): Place | null {
  const kind = node.kind();
  if (kind === 'variable_declaration') return variablePlace(node);
  if (kind === 'catch_block') return local(node);
  const scope = node.parent()?.parent();
  if (!scope) return null;
  const field =
    kind === 'class_parameter' &&
    node.children().some((child) => child.kind() === 'binding_pattern_kind');
  return { scope, field, afterDeclaration: false, property: null };
}

function declaredBy(node: AstNode): Declared[] {
  const name = nameOf(node);
  const place = name ? placeOf(node) : null;
  if (!name || !place) return [];
  const { start, end } = place.scope.range();
  const at = place.afterDeclaration ? node.range().start.index : start.index;
  const type = childOf(node, TYPES);
  const value = !type && place.property ? valueOf(place.property) : null;
  return [
    { name: name.text(), from: start.index, to: end.index, at, field: place.field, type, value },
  ];
}

export function declarationsIn(nodes: ReadonlyMap<string, AstNode[]>): FindDeclared<Declared> {
  return scopeLookup(
    DECLARATION_KINDS.flatMap((kind) => nodes.get(kind) ?? []).flatMap(declaredBy),
  );
}
