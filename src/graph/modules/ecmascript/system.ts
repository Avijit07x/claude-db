import { javascript, tsx, typescript } from '../../languages/ecmascript.js';
import type { ModuleSystem } from '../system.js';
import { bindImports } from './bind.js';
import { readExports } from './exports.js';
import { ecmascriptResolver } from './resolver.js';

export const ecmascript: ModuleSystem = {
  languages: [typescript, tsx, javascript].map((spec) => spec.label),

  read({ root, file, declare, symbols, references, owner }) {
    const exported = readExports(root, file, declare);
    const known = [...symbols, ...exported.symbols];
    return {
      added: exported.symbols,
      references: bindImports(root, file, [...references, ...exported.references], known, owner),
    };
  },

  resolver: ecmascriptResolver,

  isExternal: (specifier) => !specifier.startsWith('.'),

  importsNames: true,
};
