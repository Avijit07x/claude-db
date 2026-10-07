# Improve: list the files that import a symbol

Part of the [find_usages accuracy findings](./find-usages-accuracy.md). Nothing here is built yet.

## Problem

`claude-db usages --mode usages <symbol>` lists who calls or references a symbol. It does not list the files
that import it. Renaming or moving a symbol changes those import lines too, so the answer to "what do I have
to touch" is short by about a third.

## Evidence

On 40 sampled symbols, TypeScript reported 71 import lines and 9 re-export lines out of 226 reference lines.
The graph showed none of them. The graph stores 1,184 `imports` edges, but they go from a file to the module
it imports, for example `eslint.config.js` to `@eslint/js`. They do not name the symbol that was imported.

## Plan

- Read the named specifiers of import and re-export statements: `import { a, b as c } from './x'` and
  `export { a } from './x'`. Start with the ECMAScript scanner in `src/graph/languages/ecmascript.ts`.
- Store one edge per specifier from the importing file to the symbol, with the line of the specifier. A
  rename `b as c` keeps the original name `b`, so the edge points at the right symbol.
- Resolve the module path to a scanned file, so a specifier binds to the symbol in that file and not to a
  same-named symbol elsewhere. The resolver is `src/graph/scan/resolve.ts`.
- `usages` prints an "Imported by" group next to "Referenced by", one line per importing file.
- Barrel files stay visible: a symbol imported through `index.ts` shows the barrel as a re-export.

## Done when

- Run the [accuracy measurement](./find-usages-accuracy.md) again. The graph finds at least 95% of the import
  and re-export lines in `src` that TypeScript reports.
- Call-site results do not change.
- Tests cover a plain import, a renamed import, a re-export, a type-only import and a default import.

## Risks

- Dynamic `import()` and `require` calls give a module but no named symbol. They are not covered here.
- Other languages import in other ways. Do one language first, TypeScript and JavaScript, and say so in the
  output of the languages that are not done.
- The number of edges grows. 1,184 import edges become one per specifier, so measure scan time and database
  size on a large repository before shipping.
