import type { AstNode } from '../../parser.js';
import { addSpace, newFacts } from '../binding.js';
import type { ImportFacts } from '../binding.js';

const IMPORTS = /\bimport\b/;
const VERSION_SEGMENT = /^v\d+$/;
const VERSION_SUFFIX = /\.v\d+$/;
const IDENTIFIER = /^[A-Za-z_]\w*$/;
const QUOTES = /^["`]|["`]$/g;

export function packageName(path: string): string | undefined {
  const segments = path.split('/');
  const last = segments.at(-1) ?? '';
  const named = VERSION_SEGMENT.test(last) && segments.length > 1 ? segments.at(-2) : last;
  const name = (named ?? '').replace(VERSION_SUFFIX, '');
  return IDENTIFIER.test(name) ? name : undefined;
}

function readSpec(facts: ImportFacts, spec: AstNode): void {
  const path = spec.field('path')?.text().replace(QUOTES, '');
  if (!path) return;
  const alias = spec.field('name');
  if (alias && alias.kind() !== 'package_identifier') return;
  const local = alias?.text() ?? packageName(path);
  if (local) addSpace(facts, local, { specifier: path });
}

export function readImports(root: AstNode, source: string): ImportFacts {
  const facts = newFacts();
  if (!IMPORTS.test(source)) return facts;
  for (const spec of root.findAll({ rule: { kind: 'import_spec' } })) readSpec(facts, spec);
  return facts;
}
