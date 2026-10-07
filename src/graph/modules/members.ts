import { sameNode } from '../ast.js';
import type { AstNode } from '../parser.js';
import type { InContext } from './binding.js';

type Child = string | ((node: AstNode) => AstNode | null);

export interface MemberSyntax {
  member: string;
  object: Child;
  name: string | ((member: AstNode) => string);
  call?: string;
  callee?: Child;
}

export interface MemberAccess {
  isReceiverOfCall: (member: AstNode) => boolean;
  isMemberObject: InContext;
  memberChain: (first: AstNode) => string[];
}

const childOf = (node: AstNode, child: Child): AstNode | null =>
  typeof child === 'string' ? node.field(child) : child(node);

export function memberAccess(syntax: MemberSyntax): MemberAccess {
  const isReceiverOfCall = (member: AstNode): boolean => {
    if (member.kind() !== syntax.member || !syntax.call || !syntax.callee) return false;
    const call = member.parent();
    return call?.kind() === syntax.call && sameNode(childOf(call, syntax.callee), member);
  };

  const isMemberObject: InContext = (node, parent) =>
    parent.kind() === syntax.member &&
    sameNode(childOf(parent, syntax.object), node) &&
    !isReceiverOfCall(parent);

  const nameOf = (member: AstNode): string =>
    typeof syntax.name === 'string'
      ? (member.field(syntax.name)?.text() ?? '')
      : syntax.name(member);

  const memberChain = (first: AstNode): string[] => {
    const names = [nameOf(first)];
    let top = first;
    for (let up = top.parent(); up?.kind() === syntax.member; up = top.parent()) {
      if (!sameNode(childOf(up, syntax.object), top)) break;
      top = up;
      names.push(nameOf(top));
    }
    if (isReceiverOfCall(top)) names.pop();
    return names.filter(Boolean);
  };

  return { isReceiverOfCall, isMemberObject, memberChain };
}
