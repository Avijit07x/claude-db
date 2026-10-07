import { originOf } from '../../ast.js';
import type { AstNode } from '../../parser.js';
import type { Receiver, Reference } from '../../types.js';
import {
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

const EXACT = false;
const NAME = 'simple_identifier';
const TYPE = 'type_identifier';
const CALL = 'call_expression';
const NAVIGATION = 'navigation_expression';
const RETURN_TYPES = new Set(['user_type', 'nullable_type']);

export const RECEIVER_KINDS = [...DECLARATION_KINDS, 'function_declaration', 'type_parameter'];

function pathOf(node: AstNode | null | undefined): string[] {
  if (!node) return [];
  if (node.kind() === 'nullable_type') return pathOf(node.children()[0]);
  if (node.kind() !== 'user_type') return [];
  return node
    .children()
    .filter((child) => child.kind() === TYPE)
    .map((child) => child.text());
}

function dottedPath(node: AstNode): string[] | null {
  if (node.kind() === NAME) return [node.text()];
  if (node.kind() !== NAVIGATION) return null;
  const [owner, suffix] = node.children();
  const name = suffix?.children().find((child) => child.kind() === NAME);
  const head = owner ? dottedPath(owner) : null;
  return head && name ? [...head, name.text()] : null;
}

function returnType(parts: AstNode[], kinds: string[]): AstNode | null {
  const after = kinds.indexOf('function_value_parameters');
  const at = kinds.findIndex((kind, index) => index > after && RETURN_TYPES.has(kind));
  return at < 0 ? null : (parts[at] ?? null);
}

export function kotlinTyping(input: ReceiverInput): Typing {
  const { nodes, facts, own, symbols } = input;
  const find = declarationsIn(nodes);
  const generics = typeParameterNames(nodes);
  const ofPath = pathReceivers({ own, facts, generics, exact: EXACT });

  const ofCall = (call: AstNode): Receiver => {
    const callee = call.children()[0];
    const constructed = callee?.kind() === NAME && TYPE_NAME.test(callee.text());
    return (constructed ? ofPath([callee.text()]) : null) ?? resultOf(originOf(call), EXACT);
  };

  const ofDeclared = memoize((declared: Declared): Receiver | null => {
    if (declared.type) return ofPath(pathOf(declared.type));
    return declared.value?.kind() === CALL ? ofCall(declared.value) : null;
  });

  const ofNavigation = (navigation: AstNode, position: number): Receiver | null => {
    const [owner, suffix] = navigation.children();
    const name = suffix?.children().find((child) => child.kind() === NAME);
    if (owner?.kind() === 'this_expression' && name) {
      const declared = find(name.text(), position, true);
      return declared ? ofDeclared(declared) : null;
    }
    const path = dottedPath(navigation);
    return path && TYPE_NAME.test(path.at(-1) ?? '') ? ofPath(path) : null;
  };

  const ofObject = (object: AstNode, position: number): Receiver | null => {
    const kind = object.kind();
    if (kind === 'this_expression') {
      const outer = object.children().find((child) => child.kind() === TYPE);
      return outer ? ofPath([outer.text()]) : SELF;
    }
    if (kind === 'super_expression') return PARENT;
    if (kind === CALL) return ofCall(object);
    if (kind === 'as_expression') return ofPath(pathOf(object.children().at(-1)));
    if (kind === 'parenthesized_expression') {
      const inner = object.children().find((child) => !['(', ')'].includes(child.kind()));
      return inner ? ofObject(inner, position) : null;
    }
    if (kind === NAVIGATION) return ofNavigation(object, position);
    if (kind !== NAME) return null;
    const name = object.text();
    const declared = find(name, position);
    if (declared) return ofDeclared(declared);
    return TYPE_NAME.test(name) ? ofPath([name]) : null;
  };

  const receiverOf = (object: AstNode | null, position: number): Receiver =>
    object ? (ofObject(object, position) ?? UNKNOWN) : SELF;

  const attach = (references: Reference[]): Reference[] => {
    const idOf = symbolAt(symbols);
    const returns = new Map<string, Receiver>();
    for (const declaration of nodes.get('function_declaration') ?? []) {
      const parts = declaration.children();
      const kinds = parts.map((part) => part.kind());
      const name = parts[kinds.indexOf(NAME)];
      const id = name ? idOf(name) : undefined;
      const receiver = ofPath(pathOf(returnType(parts, kinds)));
      if (id && receiver) returns.set(id, receiver);
    }
    return attachReceivers(references, { returns });
  };

  return { receiverOf, attach };
}
