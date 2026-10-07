import type { EdgeRelation, SymbolKind } from '../../types.js';

export interface DefinitionRule {
  kind: string;
  field: string[];
  symbol: SymbolKind;
  nameKind?: string;
  memberOf?: string[];
}

export interface ListItem {
  kind: string;
  field?: string;
  select?: string[];
}

export interface ReferenceRule {
  kind: string;
  field: string[];
  relation: EdgeRelation;
  namePattern?: RegExp;
  excludeParents?: string[];
  objectKinds?: string[];
  listOf?: ListItem[];
  qualifier?: string;
  parents?: string[];
}

export interface LanguageSpec {
  id: string;
  label: string;
  extensions: string[];
  definitions: DefinitionRule[];
  references: ReferenceRule[];
  basic?: boolean;
}
