import { python as spec } from '../../languages/python.js';
import { bindModule } from '../binding.js';
import type { ModuleSystem } from '../system.js';
import { grammar } from './grammar.js';
import { readImports } from './imports.js';
import { pythonResolver } from './resolver.js';

export const python: ModuleSystem = {
  languages: [spec.label],

  read({ root, file, symbols, references, owner }) {
    const facts = readImports(root, file.source);
    const input = { root, path: file.path, references, symbols, owner };
    return { added: [], references: bindModule(input, facts, grammar) };
  },

  resolver: pythonResolver,

  isExternal: (specifier) => !specifier.startsWith('.'),

  importsNames: true,
};
