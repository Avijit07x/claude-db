import type { LanguageSpec } from './rules.js';

export const ruby: LanguageSpec = {
  id: 'ruby',
  label: 'ruby',
  extensions: ['.rb', '.rake'],
  definitions: [
    { kind: 'method', field: ['name'], symbol: 'method' },
    { kind: 'singleton_method', field: ['name'], symbol: 'method' },
    { kind: 'class', field: ['name'], symbol: 'class' },
    { kind: 'module', field: ['name'], symbol: 'class' },
  ],
  references: [
    { kind: 'call', field: ['method'], relation: 'calls' },
    { kind: 'call', field: ['receiver'], relation: 'references' },
    { kind: 'class', field: ['superclass'], relation: 'extends' },
  ],
};
