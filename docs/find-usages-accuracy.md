# find_usages accuracy: what was measured

How well the code graph and the text search answer "who uses this symbol". Measured on this repository on
2026-10-06. The improvement files that follow from it:

- [improve-usages-imports.md](./improve-usages-imports.md)
- [improve-usages-same-name.md](./improve-usages-same-name.md)
- [improve-impact-analysis.md](./improve-impact-analysis.md)
- [improve-notes-on-symbols.md](./improve-notes-on-symbols.md)

## Method

1. Scan the repository into an empty database with `claude-db scan`. 3,511 symbols and 16,132 edges.
2. Take the exported functions and classes under `src/` whose name is unique among exported declarations,
   then keep every few of them: 40 symbols.
3. Ask the TypeScript language service for every reference to each one. That is the ground truth. Files
   outside the TypeScript project (the `.mjs` tests and scripts) are left out of the comparison.
4. Ask the graph (`claude-db usages --mode usages <name>`) and the text search (`mode: "text"`) for the
   same names and compare line by line.

The 226 reference lines TypeScript reports split into 103 call sites, 71 import lines, 9 re-export lines,
40 definition lines (TypeScript reports the declaration too) and 3 others.

## Results

| Question                                          | Result                                                     |
| ------------------------------------------------- | ---------------------------------------------------------- |
| Does the graph find the real call sites?          | 103 of 103                                                 |
| Does the graph list files that import the symbol? | 0 of 71 import lines, 0 of 9 re-export lines               |
| Does the graph report lines that are not uses?    | 7 of 109 lines in `src` (6%), all from same-name symbols   |
| Does the text search drown the answer in noise?   | 12 of 236 lines in `src` (5%), none in comments or strings |

What this means:

- **Calls are reliable.** On this sample the graph found every call site.
- **Imports are missing.** A symbol that is renamed or moved also changes in every file that imports it. The
  graph does not show those files, so "who uses this" is incomplete for that job. See the first file.
- **Same-name symbols are merged.** A name defined in several places gets one pile of references. See the
  second file.
- **Text search is fine.** Its extra lines are mostly a method with the same name as the function. It is not
  worth a change.

## Limits

- One repository, and TypeScript only. The other languages the scanner reads (Python, Go, Rust, Ruby and the
  pattern-based ones) were not measured.
- 40 symbols. The 103 of 103 figure is a small sample, so read it as "no misses were found", not as 100%.
- The sample holds exported functions and classes. Methods, constants and types were not sampled.
- Only `src/` is compared. Calls from tests and scripts were not checked against ground truth.
- The first run of this measurement gave 46% and 48% because the comparison counted definition lines as
  calls and counted tests and docs as noise. Those figures were wrong and are not used here.
