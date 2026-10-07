import type { CodeSymbol } from '../../../types.js';
import type { AstNode } from '../../parser.js';
import type { Reference, SourceFile } from '../../types.js';
import { bindModule } from '../binding.js';
import type { Grammar } from '../binding.js';
import { isLocalContext, isLocalExport, isMemberObject, isUse, memberChain } from './contexts.js';
import { readImports, readLoadedImports } from './imports.js';

const SHORTHAND = 'shorthand_property_identifier';

const grammar: Grammar = {
  kinds: ['identifier', SHORTHAND],
  shorthand: SHORTHAND,
  isUse: (node, parent) => isLocalExport(node, parent) || isUse(node, parent),
  isLocalUse: isLocalContext,
  isMemberObject,
  memberChain,
};

export function bindImports(
  root: AstNode,
  file: SourceFile,
  references: Reference[],
  symbols: CodeSymbol[],
  owner: (line: number) => CodeSymbol | null,
): Reference[] {
  const facts = readImports(root);
  readLoadedImports(root, file.source, facts);
  return bindModule({ root, path: file.path, references, symbols, owner }, facts, grammar);
}
