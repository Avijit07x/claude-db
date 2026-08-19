import type { LanguageSpec } from './rules.js';

export const python: LanguageSpec = {
  id: 'python',
  label: 'python',
  extensions: ['.py', '.pyi'],
  definitions: [
    { kind: 'function_definition', field: ['name'], symbol: 'function' },
    { kind: 'class_definition', field: ['name'], symbol: 'class' },
  ],
  references: [
    { kind: 'call', field: ['function'], relation: 'calls' },
    { kind: 'call', field: ['function', 'attribute'], relation: 'calls' },
    { kind: 'import_from_statement', field: ['module_name'], relation: 'imports' },
    { kind: 'class_definition', field: ['superclasses'], relation: 'extends' },
  ],
};
