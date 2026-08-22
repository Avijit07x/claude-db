import { BASIC_LANGUAGES } from './basic.js';
import { javascript, tsx, typescript } from './ecmascript.js';
import { go } from './go.js';
import { python } from './python.js';
import { ruby } from './ruby.js';
import { rust } from './rust.js';
import type { LanguageSpec } from './rules.js';

export type { DefinitionRule, LanguageSpec, ReferenceRule } from './rules.js';

export const LANGUAGES: LanguageSpec[] = [typescript, tsx, javascript, python, go, rust, ruby];

export const DYNAMIC_LANGUAGES = ['python', 'go', 'rust', 'ruby'];

export { BASIC_FINGERPRINT, callsIn, declarationsIn } from './basic.js';

const BY_EXTENSION = new Map<string, LanguageSpec>();
for (const spec of [...LANGUAGES, ...BASIC_LANGUAGES]) {
  for (const extension of spec.extensions) BY_EXTENSION.set(extension, spec);
}

export function languageFor(path: string): LanguageSpec | null {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return null;
  return BY_EXTENSION.get(path.slice(dot).toLowerCase()) ?? null;
}

export function languageNames(): string {
  return `${LANGUAGES.map((spec) => spec.label).join(', ')}, and ${BASIC_LANGUAGES.length} more by pattern`;
}
