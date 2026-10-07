import { sameNode } from '../../ast.js';
import type { AstNode } from '../../parser.js';
import type { Reference } from '../../types.js';
import type { Grammar, ImportFacts, InContext, Target } from '../binding.js';
import { CLASS_LIKE, here, qualifiedTarget, referenceTarget } from '../jvm/linking.js';
import type { Chain } from '../jvm/linking.js';
import { memberAccess } from '../members.js';

const NAME = 'simple_identifier';
const TYPE = 'type_identifier';

const members = memberAccess({
  member: 'navigation_expression',
  object: (member) => member.children()[0] ?? null,
  name: (member) =>
    member
      .children()
      .at(-1)
      ?.children()
      .find((child) => child.kind() === NAME)
      ?.text() ?? '',
  call: 'call_expression',
  callee: (call) => call.children()[0] ?? null,
});

const NAMING_PARENTS = new Set([
  'class_declaration',
  'object_declaration',
  'type_alias',
  'type_parameter',
  'function_declaration',
  'parameter',
  'class_parameter',
  'variable_declaration',
  'enum_entry',
  'import_alias',
  'navigation_suffix',
  'identifier',
  'catch_block',
  'package_header',
  'import_header',
]);

function isHeritage(parent: AstNode): boolean {
  if (parent.kind() !== 'user_type') return false;
  const holder = parent.parent();
  const specifier = holder?.kind() === 'constructor_invocation' ? holder.parent() : holder;
  return specifier?.kind() === 'delegation_specifier';
}

const isUse: InContext = (node, parent) =>
  !NAMING_PARENTS.has(parent.kind()) &&
  !isHeritage(parent) &&
  !(parent.kind() === 'call_expression' && sameNode(parent.children()[0] ?? null, node));

function qualifiedChain(node: AstNode, parent: AstNode): Chain | undefined {
  if (parent.kind() !== 'user_type') return undefined;
  const parts = parent.children().filter((child) => child.kind() === TYPE);
  const at = parts.findIndex((part) => sameNode(part, node));
  return at < 0 ? undefined : { segments: parts.map((part) => part.text()), at };
}

export function grammarFor(own: string): Grammar {
  const target = (node: AstNode, parent: AstNode, facts: ImportFacts): Target | undefined => {
    const text = node.text();
    if (node.kind() === NAME && !CLASS_LIKE.test(text)) return undefined;
    if (!isUse(node, parent)) return undefined;
    const chain = qualifiedChain(node, parent);
    if (chain && chain.segments.length > 1) return qualifiedTarget(own, chain, facts);
    return { name: text, link: here(own, facts.opens) };
  };

  const reference = (given: Reference, facts: ImportFacts): Target | undefined =>
    referenceTarget(own, given, facts);

  return {
    kinds: [NAME, TYPE],
    isUse,
    isLocalUse: isUse,
    isMemberObject: members.isMemberObject,
    memberChain: members.memberChain,
    unbound: {
      rules: [{ kind: TYPE }, { kind: NAME, regex: '^[A-Z]' }],
      claims: (node, parent) => (qualifiedChain(node, parent)?.at ?? 0) > 0,
      target,
      reference,
    },
  };
}
