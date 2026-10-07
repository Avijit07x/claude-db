import { sameNode } from '../../ast.js';
import type { AstNode } from '../../parser.js';
import type { Grammar, ImportFacts, InContext, Target } from '../binding.js';
import { memberAccess } from '../members.js';
import type { Reference } from '../../types.js';
import { CLASS_LIKE, here, qualifiedTarget, referenceTarget } from '../jvm/linking.js';
import type { Chain } from '../jvm/linking.js';

const fields = memberAccess({ member: 'field_access', object: 'object', name: 'field' });

const DECLARING_SLOTS: Record<string, string[]> = {
  class_declaration: ['name'],
  record_declaration: ['name'],
  interface_declaration: ['name'],
  enum_declaration: ['name'],
  annotation_type_declaration: ['name'],
  method_declaration: ['name'],
  constructor_declaration: ['name'],
  formal_parameter: ['name'],
  spread_parameter: ['name'],
  variable_declarator: ['name'],
  enhanced_for_statement: ['name'],
  catch_formal_parameter: ['name'],
  enum_constant: ['name'],
  method_invocation: ['name'],
  field_access: ['field'],
  instanceof_expression: ['name'],
};
const OTHER_PARENTS = new Set([
  'scoped_identifier',
  'package_declaration',
  'import_declaration',
  'type_parameter',
  'inferred_parameters',
  'labeled_statement',
  'break_statement',
  'continue_statement',
]);
const OBJECT_PARENTS = new Set(['method_invocation', 'field_access']);
const ANNOTATIONS = new Set(['marker_annotation', 'annotation']);
const ANNOTATION_RULES = [...ANNOTATIONS].map((kind) => ({ kind }));

const occupies = (table: Record<string, string[]>, node: AstNode, parent: AstNode): boolean =>
  table[parent.kind()]?.some((slot) => sameNode(parent.field(slot), node)) ?? false;

const HERITAGE_LISTS = new Set(['super_interfaces', 'extends_interfaces']);

function isHeritage(node: AstNode, parent: AstNode): boolean {
  let holder = parent;
  if (holder.kind() === 'generic_type') {
    if (!sameNode(holder.children()[0] ?? null, node)) return false;
    holder = holder.parent() ?? holder;
  }
  if (holder.kind() === 'superclass') return true;
  return holder.kind() === 'type_list' && HERITAGE_LISTS.has(holder.parent()?.kind() ?? '');
}

function isCreation(node: AstNode, parent: AstNode): boolean {
  const generic = parent.kind() === 'generic_type';
  if (generic && !sameNode(parent.children()[0] ?? null, node)) return false;
  const holder = generic ? parent.parent() : parent;
  return (
    holder?.kind() === 'object_creation_expression' &&
    sameNode(holder.field('type'), generic ? parent : node)
  );
}

const isUse: InContext = (node, parent) =>
  !OTHER_PARENTS.has(parent.kind()) &&
  !occupies(DECLARING_SLOTS, node, parent) &&
  !isHeritage(node, parent) &&
  !isCreation(node, parent);

function namesAType(node: AstNode, parent: AstNode): boolean {
  const kind = parent.kind();
  if (OBJECT_PARENTS.has(kind)) return sameNode(parent.field('object'), node);
  if (ANNOTATIONS.has(kind)) return sameNode(parent.field('name'), node);
  if (kind === 'method_reference') return sameNode(parent.children()[0] ?? null, node);
  return false;
}

function qualifiedChain(node: AstNode): Chain | undefined {
  let outer = node.parent();
  while (outer?.parent()?.kind() === 'scoped_type_identifier') outer = outer.parent();
  if (!outer || outer.range().start.line !== node.range().start.line) return undefined;
  const offset = node.range().start.column - outer.range().start.column;
  const segments: string[] = [];
  let at = -1;
  for (const part of outer.text().matchAll(/[\w$]+/g)) {
    if (part.index === offset) at = segments.length;
    segments.push(part[0]);
  }
  return at < 0 ? undefined : { segments, at };
}

export function grammarFor(own: string): Grammar {
  const qualifiedAnnotation = (node: AstNode): Target | undefined => {
    const segments = node.text().replace(/\s+/g, '').split('.');
    const name = segments.pop();
    if (!name || segments.length === 0 || !CLASS_LIKE.test(name)) return undefined;
    return { name, link: { specifier: segments.join('.'), strict: true } };
  };

  const qualified = (node: AstNode, facts: ImportFacts): Target | undefined => {
    const chain = qualifiedChain(node);
    return chain ? qualifiedTarget(own, chain, facts) : undefined;
  };

  const target = (node: AstNode, parent: AstNode, facts: ImportFacts): Target | undefined => {
    const text = node.text();
    if (node.kind() === 'scoped_identifier') {
      return ANNOTATIONS.has(parent.kind()) && sameNode(parent.field('name'), node)
        ? qualifiedAnnotation(node)
        : undefined;
    }
    if (node.kind() === 'identifier') {
      return CLASS_LIKE.test(text) && namesAType(node, parent)
        ? { name: text, link: here(own, facts.opens) }
        : undefined;
    }
    if (!isUse(node, parent)) return undefined;
    if (parent.kind() === 'scoped_type_identifier') return qualified(node, facts);
    return { name: text, link: here(own, facts.opens) };
  };

  const reference = (given: Reference, facts: ImportFacts): Target | undefined =>
    referenceTarget(own, given, facts);

  return {
    kinds: ['identifier', 'type_identifier'],
    isUse,
    isLocalUse: isUse,
    isMemberObject: fields.isMemberObject,
    memberChain: fields.memberChain,
    unbound: {
      rules: [
        { kind: 'type_identifier' },
        { kind: 'identifier', regex: '^[A-Z]' },
        { kind: 'scoped_identifier', inside: { any: ANNOTATION_RULES } },
      ],
      claims: (node, parent) =>
        parent.kind() === 'scoped_type_identifier' && (qualifiedChain(node)?.at ?? 0) > 0,
      target,
      reference,
    },
  };
}
