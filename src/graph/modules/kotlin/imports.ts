import type { AstNode } from '../../parser.js';
import type { ImportFacts } from '../binding.js';
import { addImport, CLASS_LIKE } from '../jvm/linking.js';

export const IMPORT_KIND = 'import_header';

export function readImport(facts: ImportFacts, header: AstNode): void {
  const parts = header.children();
  const at = parts.find((child) => child.kind() === 'identifier');
  if (!at) return;

  const segments = at.text().replace(/\s+/g, '').split('.');
  const wildcard = parts.some((child) => child.kind() === 'wildcard_import');
  const alias = parts
    .find((child) => child.kind() === 'import_alias')
    ?.children()
    .find((child) => child.kind() === 'type_identifier')
    ?.text();
  const insideClass = segments.some((segment) => CLASS_LIKE.test(segment));
  const member = !wildcard && insideClass && !CLASS_LIKE.test(segments.at(-1) ?? '');
  addImport(facts, {
    segments,
    at,
    span: header,
    wildcard,
    member,
    ...(alias ? { alias } : {}),
  });
}
