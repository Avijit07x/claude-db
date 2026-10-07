import type { AstNode } from '../../parser.js';
import { addNamed, addSpace, newFacts } from '../binding.js';
import type { ImportFacts, Lines } from '../binding.js';
import { segmentsOf } from '../names.js';

const USES = /\buse\b/;
const PATHS = new Set(['identifier', 'scoped_identifier', 'self', 'crate', 'super']);
const EVERYTHING = '*';
const SELF = 'self';
const ANONYMOUS = '_';

interface Leaf {
  path: string[];
  alias?: string;
  glob: boolean;
  at: AstNode;
  span: AstNode;
}

const pathOf = (node: AstNode): string[] => segmentsOf(node.text().replace(/\s+/g, ''));

function leavesOf(node: AstNode, prefix: string[], span: AstNode = node): Leaf[] {
  const kind = node.kind();
  if (PATHS.has(kind)) return [{ path: [...prefix, ...pathOf(node)], glob: false, at: node, span }];
  if (kind === 'use_list') return node.children().flatMap((child) => leavesOf(child, prefix));
  if (kind === 'scoped_use_list') {
    const head = node.field('path');
    const list = node.field('list');
    const base = [...prefix, ...(head ? pathOf(head) : [])];
    return list ? leavesOf(list, base) : [];
  }
  if (kind === 'use_wildcard') {
    const head = node.children().find((child) => PATHS.has(child.kind()));
    const path = [...prefix, ...(head ? pathOf(head) : [])];
    return [{ path, glob: true, at: node, span: node }];
  }
  if (kind === 'use_as_clause') {
    const head = node.field('path');
    const alias = node.field('alias')?.text();
    if (!head) return [];
    return [
      {
        path: [...prefix, ...pathOf(head)],
        ...(alias ? { alias } : {}),
        glob: false,
        at: head,
        span: node,
      },
    ];
  }
  return [];
}

function enclosing(statement: AstNode): Lines | undefined {
  for (let up = statement.parent(); up; up = up.parent()) {
    if (up.kind() !== 'function_item') continue;
    const { start, end } = up.range();
    return { start: start.line + 1, end: end.line + 1 };
  }
  return undefined;
}

function readLeaf(facts: ImportFacts, leaf: Leaf, within: Lines | undefined): void {
  const scope = within ? { within } : {};
  const path = leaf.path.at(-1) === SELF ? leaf.path.slice(0, -1) : leaf.path;
  const name = path.at(-1);
  if (!name) return;
  const specifier = path.slice(0, -1).join('::');

  if (leaf.glob) {
    const link = { specifier: path.join('::'), exported: EVERYTHING };
    facts.sites.push({ at: leaf.at, span: leaf.span, imported: { name: EVERYTHING, link } });
  } else if (specifier === '') {
    if (leaf.alias === ANONYMOUS) return;
    addSpace(facts, leaf.alias ?? name, { specifier: name, ...scope });
  } else {
    const local = leaf.alias ?? name;
    if (local !== ANONYMOUS) addNamed(facts, local, { name, link: { specifier }, ...scope });
    const published = within || local === ANONYMOUS ? {} : { exported: local };
    const link = { specifier, ...published };
    facts.sites.push({ at: leaf.at, span: leaf.span, imported: { name, link } });
  }
}

export function readImports(root: AstNode, source: string): ImportFacts {
  const facts = newFacts();
  if (!USES.test(source)) return facts;

  for (const statement of root.findAll({ rule: { kind: 'use_declaration' } })) {
    const argument = statement.field('argument');
    if (!argument) continue;
    const within = enclosing(statement);
    for (const leaf of leavesOf(argument, [])) readLeaf(facts, leaf, within);
  }
  return facts;
}
