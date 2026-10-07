import type { CodeSymbol } from '../../../types.js';
import type { AstNode } from '../../parser.js';
import type { Reference } from '../../types.js';
import { bindModule, newFacts } from '../binding.js';
import type { Grammar, ImportFacts } from '../binding.js';
import type { ModuleSystem } from '../system.js';
import { HEAD_SIZE, JVM_EXTENSIONS, jvmResolver, packageName } from './packages.js';
import type { ReceiverInput, Typing } from './receivers.js';

type Nodes = ReadonlyMap<string, AstNode[]>;

export interface JvmLanguage {
  label: string;
  importKind: string;
  readImport: (facts: ImportFacts, statement: AstNode) => void;
  grammarFor: (own: string) => Grammar;
  typing: (input: ReceiverInput) => Typing;
  nodeKinds: readonly string[];
  readReferences?: (
    nodes: Nodes,
    path: string,
    owner: (line: number) => CodeSymbol | null,
    typing: Typing,
  ) => Reference[];
}

export function jvmSystem(language: JvmLanguage): ModuleSystem {
  return {
    languages: [language.label],

    read({ root, nodes, file, symbols, references, owner }) {
      const facts = newFacts();
      for (const statement of nodes.get(language.importKind) ?? []) {
        language.readImport(facts, statement);
      }
      const own = packageName(file.source.slice(0, HEAD_SIZE));
      const typing = language.typing({ nodes, facts, own, symbols });
      const extra = language.readReferences?.(nodes, file.path, owner, typing) ?? [];
      const input = {
        root,
        path: file.path,
        references: [...references, ...extra],
        symbols,
        owner,
      };
      const bound = bindModule(input, facts, language.grammarFor(own));
      return { added: [], references: typing.attach(bound) };
    },

    resolver: (root, files) => jvmResolver(root, files, JVM_EXTENSIONS),

    isExternal: () => true,

    importsNames: true,

    nodeKinds: [language.importKind, ...language.nodeKinds],
  };
}
