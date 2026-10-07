# Adding a language to the code graph

A language is mostly data: a spec of the syntax that declares and uses names, and, to follow imports, a
small module system. `python` is the shortest example to copy at each step.

1. Add the grammar as a dev dependency, `npm install -D @ast-grep/lang-<language>`, and its name to
   `GRAMMARS` in `src/graph/grammars.ts`. A release copies its prebuilt libraries into the grammar package
   for each platform (`scripts/grammars.mjs`).
2. Create `src/graph/languages/<language>.ts` exporting a `LanguageSpec`: the node kinds that declare
   symbols and the ones that reference them.
3. Add it to `LANGUAGES` in `src/graph/languages/index.ts`, and its extensions to
   `src/graph/languages/basic.ts`, so it is read by pattern where no grammar package installs.
4. Bump `SCAN_VERSION` in `src/graph/scan/files.ts`, so existing users re-read their files.
5. To follow imports, add `src/graph/modules/<language>/` and list it in `src/graph/modules/registry.ts`. It
   needs `imports.ts` (the import syntax), `resolver.ts` (a module name to a file), `grammar.ts` (which
   names are uses, and what hides one) and `system.ts` to join them. Binding, re-exports and scopes are
   shared in `binding.ts`.

To see the node kinds and fields a grammar has, parse a sample file and print its tree.

## Tests

Each case is one file, `scripts/unit/fixtures/graph/<language>/<claim>.txt`. The name says what it proves.
Each source file goes under a `=== <path>` line, and the symbols and edges the scan must produce go under
`=== expected`:

```
=== src/a/Item.java
package a;

public class Item {}
=== expected
symbol src/a/Item.java:3 Item class
```

Write the sources, then run `CLAUDE_DB_UPDATE_FIXTURES=1 npm run unit` to fill in the expected lines, and
read every line before you commit. After that, `npm run unit` fails on any line that changes.

## The benchmark

`npm run bench:usages` checks the graph against answers that do not use the scanner: the TypeScript
service, Python's `ast`, the JDK compiler, and text checkers for Go, Rust and Kotlin. It runs on public
repositories pinned in `scripts/bench-usages/corpus.json` and never runs their code. Python needs `python3`,
Java needs a JDK. A new language is checked on three repositories against an answer of its own.

- `--only zod,java` measures some repositories or languages.
- `--check` fails on a regression against `scripts/bench-usages/baseline.json`. A nightly workflow runs it.
- `--write-baseline` saves a new baseline. Commit it with the change that improves the numbers.
