import { java as spec } from '../../languages/java.js';
import { jvmSystem } from '../jvm/system.js';
import { grammarFor } from './grammar.js';
import { IMPORT_KIND, readImport } from './imports.js';
import { RECEIVER_KINDS, javaTyping } from './receivers.js';

export const java = jvmSystem({
  label: spec.label,
  importKind: IMPORT_KIND,
  readImport,
  grammarFor,
  typing: javaTyping,
  nodeKinds: RECEIVER_KINDS,
});
