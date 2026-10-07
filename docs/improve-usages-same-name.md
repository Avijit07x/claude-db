# Improve: keep same-name symbols apart

Part of the [find_usages accuracy findings](./find-usages-accuracy.md). Nothing here is built yet. It works
best after [importing symbols are recorded](./improve-usages-imports.md), because that gives the binding
between a use and its definition.

## Problem

When several symbols share a name, `usages` prints all their definitions and then one list of references for
all of them. A caller of one function cannot be told apart from a caller of another. A rename check that
uses the pile would either touch code it should not or report more risk than there is.

## Evidence

In this repository `readJson` is defined three times: a test helper, `src/cli/files.ts`, and a private
function in `src/pick/pending.ts`. `usages` shows the three definitions and then "Referenced by (17)" in one
block. In the 40-symbol sample the graph returned 7 lines in `src` that TypeScript does not count as uses of
the symbol asked about, 6% of the 109 it returned, all from this mixing.

## Plan

- When a call or reference is found, bind it to a definition in this order:
  1. a definition in the same file,
  2. the definition the file imports under that name (needs the import edges),
  3. a definition in the same directory or package,
  4. otherwise any definition with that name, marked as inferred, as today.
- Steps 1 and 2 count as certain, the same as an extracted edge. Steps 3 and 4 keep a score.
- `usages` prints the references under the definition they belong to. A group that cannot be bound is shown
  last and labeled as unbound.
- Keep the old merged answer behind a flag for one release, in case someone relies on it.

## Done when

- Run the [accuracy measurement](./find-usages-accuracy.md) again. The lines the graph reports that are not
  uses fall from 6% to under 2%.
- A test with two files that each define and call a function of the same name shows each call under its own
  definition.
- A test with a call that cannot be bound still lists it, labeled as unbound, and does not drop it.

## Risks

- Binding is a guess for dynamic code. The fallback in step 4 must stay, so a call is never dropped.
- Other languages bind names in other ways. As with the import work, do TypeScript and JavaScript first.
