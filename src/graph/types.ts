import type { CodeSymbol, EdgeRelation } from '../types.js';
import type { LanguageSpec } from './languages/rules.js';

export interface ModuleLink {
  specifier: string;
  member?: string;
  via?: string[];
  strict?: boolean;
  exported?: string;
  namespace?: boolean;
  opens?: string[];
}

export interface TypeRef {
  name: string;
  link?: ModuleLink;
}

export type Receiver =
  | { kind: 'type'; type: TypeRef; exact?: true }
  | { kind: 'result'; of: string; exact?: true }
  | { kind: 'self' }
  | { kind: 'parent' }
  | { kind: 'outside' }
  | { kind: 'unknown' };

export interface Reference {
  file: string;
  name: string;
  relation: EdgeRelation;
  line: number;
  from: CodeSymbol | null;
  weak?: boolean;
  to?: string;
  origin?: string;
  link?: ModuleLink;
  receiver?: Receiver;
  returns?: Receiver;
}

export interface Extraction {
  symbols: CodeSymbol[];
  references: Reference[];
}

export interface SourceFile {
  unreadable?: boolean;
  path: string;
  spec: LanguageSpec;
  source: string;
  hash: string;
}
