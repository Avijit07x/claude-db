import type { LanguageSpec, ListItem } from './rules.js';

const TYPES: ListItem[] = [
  { kind: 'type_identifier' },
  { kind: 'scoped_type_identifier' },
  { kind: 'generic_type', select: ['type_identifier', 'scoped_type_identifier'] },
];

export const java: LanguageSpec = {
  id: 'java',
  label: 'java',
  extensions: ['.java'],
  definitions: [
    { kind: 'class_declaration', field: ['name'], symbol: 'class' },
    { kind: 'record_declaration', field: ['name'], symbol: 'class' },
    { kind: 'interface_declaration', field: ['name'], symbol: 'interface' },
    { kind: 'annotation_type_declaration', field: ['name'], symbol: 'interface' },
    { kind: 'enum_declaration', field: ['name'], symbol: 'enum' },
    { kind: 'method_declaration', field: ['name'], symbol: 'method' },
  ],
  references: [
    { kind: 'method_invocation', field: ['name'], relation: 'calls' },
    { kind: 'method_invocation', field: ['name'], qualifier: 'object', relation: 'calls' },
    { kind: 'object_creation_expression', field: [], relation: 'calls', listOf: TYPES },
    { kind: 'superclass', field: [], relation: 'extends', listOf: TYPES },
    {
      kind: 'type_list',
      field: [],
      relation: 'implements',
      parents: ['super_interfaces'],
      listOf: TYPES,
    },
    {
      kind: 'type_list',
      field: [],
      relation: 'extends',
      parents: ['extends_interfaces'],
      listOf: TYPES,
    },
  ],
};
