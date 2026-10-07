import { kotlin as spec } from '../../languages/kotlin.js';
import { jvmSystem } from '../jvm/system.js';
import { grammarFor } from './grammar.js';
import { IMPORT_KIND, readImport } from './imports.js';
import { RECEIVER_KINDS, kotlinTyping } from './receivers.js';
import { REFERENCE_KINDS, readReferences } from './references.js';

export const kotlin = jvmSystem({
  label: spec.label,
  importKind: IMPORT_KIND,
  readImport,
  grammarFor,
  typing: kotlinTyping,
  readReferences,
  nodeKinds: [...REFERENCE_KINDS, ...RECEIVER_KINDS],
});
