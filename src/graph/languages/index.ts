import { GRAMMARS, hasGrammar } from '../grammars.js';
import { BASIC_LANGUAGES } from './basic.js';
import { javascript, tsx, typescript } from './ecmascript.js';
import { go } from './go.js';
import { java } from './java.js';
import { kotlin } from './kotlin.js';
import { python } from './python.js';
import { ruby } from './ruby.js';
import { rust } from './rust.js';
import type { LanguageSpec } from './rules.js';

export type { LanguageSpec } from './rules.js';

export const LANGUAGES: LanguageSpec[] = [
  typescript,
  tsx,
  javascript,
  python,
  go,
  rust,
  ruby,
  java,
  kotlin,
];

export { BASIC_FINGERPRINT, callsIn, declarationsIn } from './basic.js';

export const needsGrammar = (spec: LanguageSpec): boolean => GRAMMARS.includes(spec.id);

const isReadable = (spec: LanguageSpec): boolean => !needsGrammar(spec) || hasGrammar(spec.id);

const byExtension = (specs: LanguageSpec[]): Map<string, LanguageSpec> => {
  const found = new Map<string, LanguageSpec>();
  for (const spec of specs) {
    for (const extension of spec.extensions) found.set(extension, spec);
  }
  return found;
};

const REAL = byExtension(LANGUAGES);
const BASIC = byExtension(BASIC_LANGUAGES);

export function languageFor(path: string): LanguageSpec | null {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return null;
  const extension = path.slice(dot).toLowerCase();
  const real = REAL.get(extension);
  if (real && isReadable(real)) return real;
  return BASIC.get(extension) ?? null;
}

export function languageNames(): string {
  const parsed = LANGUAGES.filter(isReadable).map((spec) => spec.label);
  const patterns = BASIC_LANGUAGES.filter((spec) => !parsed.includes(spec.label));
  return `${parsed.join(', ')}, and ${patterns.length} more by pattern`;
}
