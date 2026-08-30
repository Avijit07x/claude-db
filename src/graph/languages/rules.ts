import type { EdgeRelation, SymbolKind } from '../../types.js';

export interface DefinitionRule {
  kind: string;
  field: string[];
  symbol: SymbolKind;
}

export interface ReferenceRule {
  kind: string;
  field: string[];
  relation: EdgeRelation;
  namePattern?: RegExp;
}

export interface LanguageSpec {
  id: string;
  label: string;
  extensions: string[];
  definitions: DefinitionRule[];
  references: ReferenceRule[];
  basic?: boolean;
}
