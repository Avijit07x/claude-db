# Improve: impact analysis, "what breaks if I change this"

Part of the [find_usages accuracy findings](./find-usages-accuracy.md). Nothing here is built yet. The two
files before it come first, because impact analysis is only as good as the edges it walks:
[imports](./improve-usages-imports.md), then [same-name symbols](./improve-usages-same-name.md).

## Problem

The graph answers who uses a symbol, what it is, and the path between two symbols. It does not answer "what
could break if I change this". Claude edits a shared function and learns of the damage later, from failing
tests. Asking for the callers one level at a time and joining them by hand is slow and easy to get wrong.

## Evidence

The first measurement found every call site on the sample ([accuracy findings](./find-usages-accuracy.md)),
so walking the edges outward is worth trying. The sample is small and TypeScript only, so the first build
must measure again on its own results.

## Plan

- `claude-db impact <symbol>` follows callers outward to a depth, default 3. The output groups them by
  distance, then by file, and marks test files.
- `claude-db impact --diff` takes the uncommitted changes, finds which symbols the changed lines fall in, and
  lists what depends on them. A symbol stores only its start line, so a changed line maps to the nearest
  symbol above it. A later version can add an end line, which needs a schema change.
- A matching MCP tool, so Claude can ask before it edits a shared symbol. Its description says to call it
  before changing anything with callers in more than one file.
- Safeguards: a cycle guard, a cap on the number of nodes with a note saying how many were cut, and a clear
  label for edges that are inferred, with their score.
- It reads the stored graph and refreshes changed files first, as `usages` does.

## Done when

- A test with a small known call graph checks the depths, the grouping, a cycle and the cap.
- A test with a real change in a temporary git repository checks that `--diff` names the right symbols.
- On this repository, `impact` for ten sampled symbols is compared with a TypeScript walk of the same depth.
  The graph finds at least 90% of the callers TypeScript finds, and the output says what it could not see.

## Risks

- Dynamic calls, callbacks and dependency injection are invisible to edges. The output must say it lists
  known dependents, not all of them, so it does not give false comfort.
- On a large repository a depth of 3 can be huge. The cap and a `--depth` flag keep it readable.
- The diff-to-symbol step is approximate until symbols store an end line.
