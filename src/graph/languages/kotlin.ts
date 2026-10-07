import type { LanguageSpec } from './rules.js';

const BODIES = ['class_body', 'enum_class_body'];

export const kotlin: LanguageSpec = {
  id: 'kotlin',
  label: 'kotlin',
  extensions: ['.kt', '.kts'],
  definitions: [
    { kind: 'class_declaration', field: [], nameKind: 'type_identifier', symbol: 'class' },
    { kind: 'object_declaration', field: [], nameKind: 'type_identifier', symbol: 'class' },
    { kind: 'type_alias', field: [], nameKind: 'type_identifier', symbol: 'type' },
    {
      kind: 'function_declaration',
      field: [],
      nameKind: 'simple_identifier',
      symbol: 'function',
      memberOf: BODIES,
    },
  ],
  references: [],
};
