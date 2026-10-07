import type { CodeSymbol } from '../../types.js';
import type { AstNode } from '../parser.js';
import type { Declare } from '../symbols.js';
import type { Reference, SourceFile } from '../types.js';

export interface ModuleResolver {
  resolve: (from: string, specifier: string) => string | null;
  child?: (module: string, segment: string) => string | null;
  unit?: (file: string) => string;
  foreign?: (from: string, specifier: string) => boolean;
}

export interface ModuleContext {
  files: ReadonlySet<string>;
  resolve(from: string, specifier: string): string | null;
  child(module: string, segment: string): string | null;
  unit(file: string): string;
  isExternal(from: string, specifier: string): boolean;
  isForeign(from: string, specifier: string): boolean;
}

export interface ReadInput {
  root: AstNode;
  nodes: ReadonlyMap<string, AstNode[]>;
  file: SourceFile;
  declare: Declare;
  symbols: CodeSymbol[];
  references: Reference[];
  owner: (line: number) => CodeSymbol | null;
}

export interface ModuleFacts {
  added: CodeSymbol[];
  references: Reference[];
}

export interface ModuleSystem {
  readonly languages: readonly string[];
  read(input: ReadInput): ModuleFacts;
  resolver(root: string, files: ReadonlySet<string>): ModuleResolver;
  isExternal(specifier: string): boolean;
  importsNames: boolean;
  nodeKinds?: readonly string[];
}
