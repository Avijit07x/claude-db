# Improve: show what was decided about a symbol

Part of the [find_usages accuracy findings](./find-usages-accuracy.md). This one is an idea. It has not been
measured, so treat the plan as a first guess. Nothing here is built yet.

## Problem

Memory and the code graph are separate. `usages --mode explain <symbol>` says what a symbol is and what it
reaches. It does not say that someone decided not to touch it, or that an earlier attempt to change it
failed. That is the case where memory would help most, and Claude has to think of searching for it.

## Evidence

None yet. Two things point the other way, so measure first:

- The per-file memory idea in [memory-improvements.md](./memory-improvements.md) (Phase 4) was rated weak,
  because a shared file is weak evidence on its own (AUC 0.51).
- Notes mention a symbol by name only sometimes. How often is not known.

An exact symbol name inside a note is a much stronger signal than a shared file, but that has to be shown.

## First step: measure

- For each symbol in a scanned repository, count the notes whose text contains the exact name as a whole
  word, and how many of those a person would call relevant when looking at that symbol.
- Do it on a real project's memory and a few symbols a person picks, then judge a sample by hand. The
  existing judge in `bench:inject` could do the labeling.
- Go on only if a good share of symbols with a hit show a relevant note, and the false hits are few.

## Plan, if the measurement supports it

- `explain` ends with a "Notes about this symbol" group of at most three short lines, each with its id, so
  Claude can open one.
- Match on the whole-word symbol name and the file path in the note, not on loose similarity.
- Skip names that are common words, with a minimum length and a stop list, so a function called `list` does
  not pull in every note about lists.
- Show nothing when there is no match, so the answer does not grow for no reason.

## Done when

- The measurement is written up next to the [accuracy findings](./find-usages-accuracy.md).
- A test shows a note that names a symbol appearing under `explain`, and a common-word name showing nothing.

## Risks

- Notes go stale. A note about a symbol that was later rewritten can mislead, so each line shows the date.
- Extra lines in the answer cost tokens on every `explain`. Keep the cap and measure the average cost.
