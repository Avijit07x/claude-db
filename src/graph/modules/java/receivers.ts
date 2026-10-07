import { originFrom, originOf } from '../../ast.js';
import type { AstNode } from '../../parser.js';
import type { Receiver, Reference } from '../../types.js';
import {
  OUTSIDE,
  PARENT,
  SELF,
  TYPE_NAME,
  UNKNOWN,
  attachReceivers,
  memoize,
  pathReceivers,
  resultOf,
  symbolAt,
  typeParameterNames,
} from '../jvm/receivers.js';
import type { ReceiverInput, Typing } from '../jvm/receivers.js';
import { DECLARATION_KINDS, declarationsIn } from './declarations.js';
import type { Declared } from './declarations.js';

const INFERRED = 'var';
const EXACT = true;
const VALUES = new Set([
  'integral_type',
  'floating_point_type',
  'boolean_type',
  'void_type',
  'array_type',
]);
const LITERALS = new Set(['string_literal', 'text_block', 'array_creation_expression']);
const PATH_KINDS = new Set(['type_identifier', 'scoped_type_identifier', 'generic_type']);

export const RECEIVER_KINDS = [
  ...DECLARATION_KINDS,
  'method_invocation',
  'method_declaration',
  'type_parameter',
];

function pathOf(node: AstNode): string[] {
  const kind = node.kind();
  if (kind === 'type_identifier' || kind === 'identifier') return [node.text()];
  if (kind === 'generic_type') {
    const [head] = node.children();
    return head ? pathOf(head) : [];
  }
  if (kind !== 'scoped_type_identifier') return [];
  return node
    .children()
    .filter((child) => PATH_KINDS.has(child.kind()))
    .flatMap(pathOf);
}

function dottedPath(node: AstNode): string[] | null {
  if (node.kind() === 'identifier') return [node.text()];
  if (node.kind() !== 'field_access') return null;
  const owner = node.field('object');
  const name = node.field('field');
  const head = owner ? dottedPath(owner) : null;
  return head && name ? [...head, name.text()] : null;
}

function firstNamed(node: AstNode): AstNode | null {
  return node.children().find((child) => !['(', ')'].includes(child.kind())) ?? null;
}

export function javaTyping(input: ReceiverInput): Typing {
  const { nodes, facts, own, symbols } = input;
  const generics = typeParameterNames(nodes);
  const find = declarationsIn(nodes);
  const ofPath = pathReceivers({ own, facts, generics, exact: EXACT });

  const ofType = (node: AstNode | null): Receiver | null => {
    if (!node) return null;
    if (VALUES.has(node.kind())) return OUTSIDE;
    if (node.kind() === 'annotated_type') {
      return ofType(node.children().find((child) => !child.kind().endsWith('annotation')) ?? null);
    }
    const path = pathOf(node);
    return path.length === 1 && path[0] === INFERRED ? null : ofPath(path);
  };

  const ofValue = (value: AstNode | null | undefined): Receiver | null => {
    if (!value) return null;
    const kind = value.kind();
    if (kind === 'object_creation_expression') return ofType(value.field('type'));
    return kind === 'method_invocation' ? resultOf(originOf(value), EXACT) : null;
  };

  const ofDeclared = memoize((declared: Declared): Receiver | null => {
    if (declared.array) return OUTSIDE;
    if (declared.type?.text() !== INFERRED) return ofType(declared.type);
    return ofValue(declared.holder?.field('value'));
  });

  const ofField = (access: AstNode, position: number): Receiver | null => {
    const owner = access.field('object');
    const name = access.field('field');
    if (owner?.kind() === 'this' && name) {
      const declared = find(name.text(), position, true);
      return declared ? ofDeclared(declared) : null;
    }
    const outerThis = access.children().at(-1)?.kind() === 'this';
    if (outerThis) return owner?.kind() === 'identifier' ? ofType(owner) : null;
    const path = dottedPath(access);
    return path && TYPE_NAME.test(path.at(-1) ?? '') ? ofPath(path) : null;
  };

  const ofObject = (object: AstNode, position: number): Receiver | null => {
    const kind = object.kind();
    if (kind === 'this') return SELF;
    if (kind === 'super') return PARENT;
    if (LITERALS.has(kind)) return OUTSIDE;
    if (kind === 'method_invocation') return resultOf(originOf(object), EXACT);
    if (kind === 'object_creation_expression' || kind === 'cast_expression') {
      return ofType(object.field('type'));
    }
    if (kind === 'parenthesized_expression') {
      const inner = firstNamed(object);
      return inner ? ofObject(inner, position) : null;
    }
    if (kind === 'field_access') return ofField(object, position);
    if (kind !== 'identifier') return null;
    const name = object.text();
    const declared = find(name, position);
    if (declared) return ofDeclared(declared);
    return TYPE_NAME.test(name) ? ofPath([name]) : null;
  };

  const receiverOf = (object: AstNode | null, position: number): Receiver =>
    object ? (ofObject(object, position) ?? UNKNOWN) : SELF;

  const attach = (references: Reference[]): Reference[] => {
    const calls = new Map<string, Receiver>();
    for (const call of nodes.get('method_invocation') ?? []) {
      const range = call.range();
      calls.set(originFrom(range), receiverOf(call.field('object'), range.start.index));
    }

    const idOf = symbolAt(symbols);
    const returns = new Map<string, Receiver>();
    for (const method of nodes.get('method_declaration') ?? []) {
      const name = method.field('name');
      const id = name ? idOf(name) : undefined;
      const receiver = ofType(method.field('type'));
      if (id && receiver) returns.set(id, receiver);
    }
    return attachReceivers(references, { calls, returns });
  };

  return { receiverOf, attach };
}
