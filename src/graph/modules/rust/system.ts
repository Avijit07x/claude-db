import { rust as spec } from '../../languages/rust.js';
import { bindModule } from '../binding.js';
import type { ModuleSystem } from '../system.js';
import { grammar } from './grammar.js';
import { readImports } from './imports.js';
import { isRelative, rustResolver } from './resolver.js';

export const rust: ModuleSystem = {
  languages: [spec.label],

  read({ root, file, symbols, references, owner }) {
    const facts = readImports(root, file.source);
    const input = { root, path: file.path, references, symbols, owner };
    return { added: [], references: bindModule(input, facts, grammar) };
  },

  resolver: rustResolver,

  isExternal: (specifier) => !isRelative(specifier),

  importsNames: true,
};
