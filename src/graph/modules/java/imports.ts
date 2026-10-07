import type { AstNode } from '../../parser.js';
import type { ImportFacts } from '../binding.js';
import { addImport } from '../jvm/linking.js';

export const IMPORT_KIND = 'import_declaration';
const PATHS = new Set(['scoped_identifier', 'identifier']);

export function readImport(facts: ImportFacts, statement: AstNode): void {
  const parts = statement.children();
  const at = parts.find((child) => PATHS.has(child.kind()));
  if (!at) return;
  const kinds = parts.map((child) => child.kind());
  const segments = at.text().replace(/\s+/g, '').split('.');
  const wildcard = kinds.includes('asterisk');
  addImport(facts, { segments, at, span: statement, wildcard, member: kinds.includes('static') });
}
