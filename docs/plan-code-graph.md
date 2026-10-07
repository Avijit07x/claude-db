# Plan: the code graph and find_usages

The plan for the code graph from 0.12 on. It replaces the earlier graph plan files, removed on 2026-10-07.
An item is marked done only after its checks ran and passed.

## The goal

Before Claude changes a symbol, it gets a complete and honest list of what uses it: fresh, fast, in every
language the project uses, with no setup.

## Rules every change keeps

1. **Never miss a use without saying so.** A use is either linked to its definition or shown as a text match.
2. **Say how sure each line is.** `EXTRACTED`, `INFERRED` with a score, or text, not linked.
3. **Never answer from stale files**, on every path: the hook, the MCP tool and the CLI.
4. **Hooks never wait** on a download, a compiler or a re-parse.
5. **Work after install.** A supported language needs no extra command.
6. **Keep everything on the machine.** No new network calls at run time.
7. **Measure against an independent answer**, through the committed benchmark.
8. **Keep per-language code small.** A language is mostly data on a shared engine.

## Where we are

Imports are bound to the exact file and symbol in TypeScript, JavaScript, Python, Go, Rust, Java and Kotlin.
Phases 0 to 3, 4.1 and 4.2 are built, all for 0.12. The graph reaches Claude mostly through the grep hook, which answered 173 times in 12
saved sessions, against 32 direct `find_usages` calls.

Open gaps:

| Gap                                                                           | Phase |
| ----------------------------------------------------------------------------- | ----- |
| A symbol stores its start line only, so a diff cannot be mapped to its symbol | 6     |

## Known limits

- **All languages.** A name from outside the repository never matches a project symbol. A class declared on
  the same line as its outer class is taken as a member of the inner one. Postgres, MongoDB and Windows are
  not tested on the graph path.
- **Grep hook.** The words `grep` and a name inside a heredoc or a quoted string can be read as a grep and
  blocked. An edit that keeps the old modification time (`cp -p`) is missed until the next `claude-db scan`.
- **TypeScript and JavaScript.** Bundler aliases, `const copy = fn`, `typeof fn<T>`, `import().then(...)`,
  `require(...)` without destructuring, and a namespace import used through a renamed export (`z.gte` in zod).
- **Python.** `sys.path` changes, `importlib`, run-time names, star imports. Constants have no symbol.
- **Go.** Dot imports, build tags, a package named unlike its folder. Not checked against the Go compiler.
- **Rust.** `#[path]`, inline `mod` blocks, macros, `cfg`-dependent aliases, `Type::new()` by name. Not checked
  against the Rust compiler.
- **Java.** Generic types are not substituted (`list.get(0).run()`), fields of another class are not followed
  (`a.b.run()`), and untyped lambda parameters are matched by name. `import static a.B.*` names are matched by
  name.
- **Kotlin.** Receiver types are followed only when written or set by a constructor or a call; extension
  functions are matched by name. The grammar fails on about 1% of lines. Not checked against the Kotlin
  compiler.
- **Grammars.** Platforms without a grammar package (Linux on 32-bit, FreeBSD, Alpine) read Go, Java, Kotlin,
  Python, Ruby and Rust by pattern.

## The design

```
   grep hook             find_usages (MCP)          claude-db usages (CLI)
        \                        |                         /
         '------------- answer builder (one format) ------'
                /                |
     graph (linked uses)   text matches (live)
                |
   store  <--  incremental indexer  <--  local extraction cache
                       |
        rules (data) + module families (package, path, directory)
                       |
        grammars: one prebuilt package per platform
```

Built: the answer builder, text matches, the incremental indexer and its cache, the `package` family shared by
Java and Kotlin (`modules/jvm/`), receiver typing, and grammars per platform. Not built yet:

- **Other families.** `path` (imports by file path) and `directory` (Go, Rust).

---

## Phase 0: the benchmark lives in the repo — done

| Item                            | Status                                                                     |
| ------------------------------- | -------------------------------------------------------------------------- |
| 0.1 Checkers in the repo        | Done. `npm run bench:usages`, 28 pinned repositories, 6 oracles            |
| 0.2 Speed measured              | Done. Scan, refresh after a one-file edit, hook answer                     |
| 0.3 Baseline and regression gate | Done. `--check` failed with a resolver broken on purpose. Nightly workflow not yet run on GitHub |

The old numbers reproduce, apart from mistakes found and fixed in the old checkers (Java enum constants, nested
Rust and Kotlin comments, Kotlin labels, lines counted twice).

## Phase 1: trust every answer — done

| Item                                      | Result                                                           |
| ----------------------------------------- | ---------------------------------------------------------------- |
| 1.1 References grouped by definition      | Each definition lists its own callers                            |
| 1.2 Text matches the graph did not link   | Every repository at 99.7% of real uses or more, 24 of 28 at 100% |
| 1.3 Refresh parses only what changed      | One-file edit: up to 7 s before, 0.4 s at most now. Scan memory halved |
| 1.4 Hooks never wait                      | The answer counts changed files; the refresh runs in the background |
| 1.5 `find_usages` defaults to the graph   | Falls back to text, and says so, before the first scan           |

Two bugs were fixed on the way: a scan held every parsed tree in memory until it ended, and an incremental
`scan` did not re-link references in other files. After edits, deletes and copies, the stored graph now equals a
full scan.

---

## Phase 2: languages work after install — done

| Item                          | Result                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------- |
| 2.1 One package per platform  | `claude-db-grammars-<platform>`, about 8 MB each, from `scripts/grammars.mjs` |
| 2.2 Platform package first    | Kotlin reads with real syntax after install; `languages add` downloads nothing |
| 2.3 Publish workflow          | Publishes the grammar packages, then claude-db, at one version. Not run yet    |

A missing or empty grammar library is skipped. Linux packages declare `glibc`, so npm skips them on Alpine.

## Phase 3: less code per language — done

| Item                           | Status                                                                     |
| ------------------------------ | -------------------------------------------------------------------------- |
| 3.1 The `package` family       | Done. Java and Kotlin share `modules/jvm/`; each keeps only its syntax      |
| 3.2 Fixture tests per language | Done. 84 fixtures, one runner; the scripted checks went from 2,239 to 485 lines |

## Phase 4: method calls on a receiver

| Item                                  | Result                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------- |
| 4.1 Bind `x.method()` by its type     | Java methods 96.6–100% linked on all five repositories, was 49–96%      |
| 4.2 Unknown receivers                 | Stay `INFERRED`, listed once under all the definitions they could be    |
| 4.3 Exact TypeScript answers          | Dropped, see Not doing                                                   |

## Phase 5: new languages, on request

Each added language binds imports through its family, has fixture tests, and is checked on three public
repositories against an independent answer.

| Language | Name to file                                             |
| -------- | -------------------------------------------------------- |
| PHP      | PSR-4 in `composer.json`, then `namespace` and `use`     |
| C#       | `namespace` lines (the `package` family)                 |
| Swift    | SwiftPM target folders                                   |
| Ruby     | `require_relative`, and Zeitwerk naming for Rails        |
| C, C++   | `#include` through `compile_commands.json`               |

## Phase 6: impact analysis

- **6.1** Symbols store their end line in all three stores. A database change: shared databases update together.
- **6.2** `claude-db impact <symbol>` and `--diff` walk callers outward, with a cycle guard, a node cap and
  labels, and end with what they could not see. An MCP tool does the same.

**Done when** the walk finds 90% of the callers the TypeScript service finds, and `--diff` names the right
symbols in a test repository.

---

## Releases

| Release | Holds                                                                         |
| ------- | ----------------------------------------------------------------------------- |
| 0.12    | Imports in seven languages, and Phases 0 to 3, 4.1 and 4.2.                   |
| later   | Phase 6, with the end-line database change. Phase 5, one language at a time. |

## Decisions for the maintainer

1. Platform package names: chosen `claude-db-grammars-<platform>`, which needs no npm organisation. The npm
   token used by the publish workflow must be allowed to create these five packages.

## Not doing

- A language server per language: slow to start, needs toolchains, cannot run in a hook.
- SCIP indexers as the base: they need a building project and minutes per run.
- stack-graphs: archived by GitHub on 2025-09-09.
- Our own type checker for chained calls.
- Downloading grammars at run time.
- Exact TypeScript answers from the project's own compiler (Phase 4.3): TypeScript is already linked at
  98.3–100%, and it would cost a worker with memory limits for little gain. Dropped on 2026-10-07.

## On hold

Notes on symbols: `explain` could show memory notes that name the symbol. Measure first whether such notes are
relevant, as the per-file version scored AUC 0.51 ([memory-improvements.md](./memory-improvements.md)).

## Risks

- Common names (`get`, `id`) can bring many text matches. The answer caps them and gives the count.
- Prebuilt grammars may not load on musl (Alpine). Those languages then fall back to patterns.
- The local cache only feeds the parser. A wrong entry costs a parse, never a wrong edge.
