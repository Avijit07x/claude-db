import type { LanguageSpec } from './rules.js';

export const go: LanguageSpec = {
  id: 'go',
  label: 'go',
  extensions: ['.go'],
  definitions: [
    { kind: 'function_declaration', field: ['name'], symbol: 'function' },
    { kind: 'method_declaration', field: ['name'], symbol: 'method' },
    { kind: 'type_spec', field: ['name'], symbol: 'type' },
  ],
  references: [
    { kind: 'call_expression', field: ['function'], relation: 'calls' },
    { kind: 'call_expression', field: ['function', 'field'], relation: 'calls' },
    { kind: 'import_spec', field: ['path'], relation: 'imports' },
  ],
};
