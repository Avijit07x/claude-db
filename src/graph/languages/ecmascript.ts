import type { DefinitionRule, LanguageSpec, ReferenceRule } from './rules.js';

const SHARED_DEFINITIONS: DefinitionRule[] = [
  { kind: 'function_declaration', field: ['name'], symbol: 'function' },
  { kind: 'generator_function_declaration', field: ['name'], symbol: 'function' },
  { kind: 'method_definition', field: ['name'], symbol: 'method' },
  { kind: 'variable_declarator', field: ['name'], symbol: 'const' },
];

const SHARED_REFERENCES: ReferenceRule[] = [
  { kind: 'call_expression', field: ['function'], relation: 'calls' },
  { kind: 'call_expression', field: ['function', 'property'], relation: 'calls' },
  { kind: 'call_expression', field: ['function', 'object'], relation: 'references' },
  { kind: 'new_expression', field: ['constructor'], relation: 'calls' },
  { kind: 'import_statement', field: ['source'], relation: 'imports' },
  { kind: 'export_statement', field: ['source'], relation: 'imports' },
];

const TYPED_DEFINITIONS: DefinitionRule[] = [
  { kind: 'class_declaration', field: ['name'], symbol: 'class' },
  { kind: 'abstract_class_declaration', field: ['name'], symbol: 'class' },
  { kind: 'interface_declaration', field: ['name'], symbol: 'interface' },
  { kind: 'type_alias_declaration', field: ['name'], symbol: 'type' },
  { kind: 'enum_declaration', field: ['name'], symbol: 'enum' },
];

const TYPED_REFERENCES: ReferenceRule[] = [
  { kind: 'extends_clause', field: ['value'], relation: 'extends' },
  { kind: 'implements_clause', field: [], relation: 'implements' },
];

export const typescript: LanguageSpec = {
  id: 'TypeScript',
  label: 'typescript',
  extensions: ['.ts', '.mts', '.cts'],
  definitions: [...SHARED_DEFINITIONS, ...TYPED_DEFINITIONS],
  references: [...SHARED_REFERENCES, ...TYPED_REFERENCES],
};

export const tsx: LanguageSpec = {
  ...typescript,
  id: 'Tsx',
  label: 'tsx',
  extensions: ['.tsx'],
};

export const javascript: LanguageSpec = {
  id: 'JavaScript',
  label: 'javascript',
  extensions: ['.js', '.mjs', '.cjs', '.jsx'],
  definitions: [
    ...SHARED_DEFINITIONS,
    { kind: 'class_declaration', field: ['name'], symbol: 'class' },
  ],
  references: [...SHARED_REFERENCES, { kind: 'class_heritage', field: [], relation: 'extends' }],
};
