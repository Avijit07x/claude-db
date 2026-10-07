import { hasGrammar } from '../grammars.js';
import { LANGUAGES, languageFor, needsGrammar } from '../languages/index.js';
import { ecmascript } from './ecmascript/system.js';
import { go } from './go/system.js';
import { java } from './java/system.js';
import { kotlin } from './kotlin/system.js';
import { python } from './python/system.js';
import { rust } from './rust/system.js';
import type { ModuleContext, ModuleResolver, ModuleSystem } from './system.js';

const SYSTEMS: readonly ModuleSystem[] = [ecmascript, python, go, rust, java, kotlin];

export const moduleSystemFor = (label: string): ModuleSystem | undefined =>
  SYSTEMS.find((system) => system.languages.includes(label));

export function isTracked(label: string): boolean {
  const spec = LANGUAGES.find((candidate) => candidate.label === label);
  const available = !spec || !needsGrammar(spec) || hasGrammar(spec.id);
  return moduleSystemFor(label) !== undefined && available;
}

export const importsNames = (label: string): boolean =>
  moduleSystemFor(label)?.importsNames ?? true;

const systemOfPath = (path: string): ModuleSystem | undefined => {
  const label = languageFor(path)?.label;
  return label ? moduleSystemFor(label) : undefined;
};

export function createModuleContext(root: string, files: ReadonlySet<string>): ModuleContext {
  const resolvers = new Map<ModuleSystem, ModuleResolver>();
  const units = new Map<string, string>();
  const resolverOf = (path: string): ModuleResolver | undefined => {
    const system = systemOfPath(path);
    if (!system) return undefined;
    const resolver = resolvers.get(system) ?? system.resolver(root, files);
    resolvers.set(system, resolver);
    return resolver;
  };

  return {
    files,
    resolve: (from, specifier) => resolverOf(from)?.resolve(from, specifier) ?? null,
    child: (module, segment) => resolverOf(module)?.child?.(module, segment) ?? null,
    unit(file) {
      const known = units.get(file);
      if (known !== undefined) return known;
      const unit = resolverOf(file)?.unit?.(file) ?? file;
      units.set(file, unit);
      return unit;
    },
    isExternal: (from, specifier) => systemOfPath(from)?.isExternal(specifier) ?? false,
    isForeign: (from, specifier) => resolverOf(from)?.foreign?.(from, specifier) ?? false,
  };
}
