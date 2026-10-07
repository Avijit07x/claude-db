import { go as spec } from '../../languages/go.js';
import { bindModule } from '../binding.js';
import type { ModuleSystem } from '../system.js';
import { grammar } from './grammar.js';
import { readImports } from './imports.js';
import { goResolver } from './resolver.js';

export const go: ModuleSystem = {
  languages: [spec.label],

  read({ root, file, symbols, references, owner }) {
    const facts = readImports(root, file.source);
    const input = { root, path: file.path, references, symbols, owner };
    return { added: [], references: bindModule(input, facts, grammar) };
  },

  resolver: goResolver,

  isExternal: (specifier) => !specifier.startsWith('.'),

  importsNames: false,
};
