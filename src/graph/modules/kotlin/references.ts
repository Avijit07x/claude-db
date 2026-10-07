import { originFrom, originOf } from '../../ast.js';
import type { AstNode } from '../../parser.js';
import type { CodeSymbol, EdgeRelation } from '../../../types.js';
import type { Receiver, Reference } from '../../types.js';
import { CLASS_LIKE } from '../jvm/linking.js';
import type { Typing } from '../jvm/receivers.js';

const DOTTED = /^(?!this\b|super\b)[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/;
const NAME = 'simple_identifier';

type Owner = (line: number) => CodeSymbol | null;

function reference(
  path: string,
  owner: Owner,
  at: AstNode,
  name: string,
  relation: EdgeRelation,
  origin: AstNode,
): Reference {
  const line = at.range().start.line + 1;
  return { file: path, name, relation, line, from: owner(line), origin: originOf(origin) };
}

interface CallSite {
  path: string;
  owner: Owner;
  origin: string;
  receiver: Receiver;
}

function callOf(site: CallSite, at: AstNode, name: string): Reference {
  const line = at.range().start.line + 1;
  const { path, owner, origin, receiver } = site;
  return { file: path, name, relation: 'calls', line, from: owner(line), origin, receiver };
}

function callsOf(call: AstNode, path: string, owner: Owner, typing: Typing): Reference[] {
  const [callee] = call.children();
  if (!callee) return [];
  const kind = callee.kind();
  if (kind !== NAME && kind !== 'navigation_expression') return [];
  const range = call.range();
  const origin = originFrom(range);
  if (kind === NAME) {
    const receiver = typing.receiverOf(null, range.start.index);
    return [callOf({ path, owner, origin, receiver }, callee, callee.text())];
  }

  const parts = callee.children();
  const named = parts
    .at(-1)
    ?.children()
    .find((child) => child.kind() === NAME);
  const object = parts[0];
  if (!named || !object) return [];
  const site = { path, owner, origin, receiver: typing.receiverOf(object, range.start.index) };
  const bare = callOf(site, named, named.text());
  const qualifier = object.text().replace(/\s+/g, '');
  if (!DOTTED.test(qualifier)) return [bare];
  return [bare, callOf(site, named, `${qualifier}.${named.text()}`)];
}

function supertypesOf(specifier: AstNode, path: string, owner: Owner): Reference[] {
  const parts = specifier.children();
  const constructed = parts.find((child) => child.kind() === 'constructor_invocation');
  const type = [...parts, ...(constructed?.children() ?? [])].find(
    (child) => child.kind() === 'user_type',
  );
  const segments = (type?.children() ?? [])
    .filter((child) => child.kind() === 'type_identifier')
    .map((child) => child.text());
  const name = segments.join('.');
  if (!type || !name) return [];

  const declaration = specifier.parent();
  const interfaceOf = declaration?.children().some((child) => child.kind() === 'interface');
  const relation = constructed || interfaceOf ? 'extends' : 'implements';
  const first = segments.findIndex((segment) => CLASS_LIKE.test(segment));
  const outer =
    first < 0
      ? []
      : segments.slice(first, -1).map((_, at) => segments.slice(0, first + at + 1).join('.'));
  return [
    reference(path, owner, type, name, relation, specifier),
    ...outer.map((outerName) => reference(path, owner, type, outerName, 'references', specifier)),
  ];
}

export const REFERENCE_KINDS = ['call_expression', 'delegation_specifier'];

export function readReferences(
  nodes: ReadonlyMap<string, AstNode[]>,
  path: string,
  owner: Owner,
  typing: Typing,
): Reference[] {
  const calls = (nodes.get('call_expression') ?? []).flatMap((call) =>
    callsOf(call, path, owner, typing),
  );
  const supertypes = (nodes.get('delegation_specifier') ?? []).flatMap((specifier) =>
    supertypesOf(specifier, path, owner),
  );
  return [...calls, ...supertypes];
}
