import type { LanguageSpec } from './rules.js';

export const rust: LanguageSpec = {
  id: 'rust',
  label: 'rust',
  extensions: ['.rs'],
  definitions: [
    { kind: 'function_item', field: ['name'], symbol: 'function' },
    { kind: 'struct_item', field: ['name'], symbol: 'class' },
    { kind: 'enum_item', field: ['name'], symbol: 'enum' },
    { kind: 'trait_item', field: ['name'], symbol: 'interface' },
    { kind: 'type_item', field: ['name'], symbol: 'type' },
  ],
  references: [
    { kind: 'call_expression', field: ['function'], relation: 'calls' },
    { kind: 'use_declaration', field: ['argument'], relation: 'imports' },
  ],
};
