# With claude-db and without it

The same questions, answered both ways, measured on this repo at 0.5.3.
Reproduce with `node scripts/bench-ab.mjs`. Tokens are `chars / 4`.

Cost alone cannot answer "is it worth it" — that needs the alternative priced
too, which is what this does.

## The answer

**It pays off at about 6 symbol lookups in a session, and not before.**

Below that the injection overhead costs more than the lookups save. On this
project the observed rate has been 6 `find_usages` calls in 564 tool calls, so
the honest verdict is that most sessions have not reached break-even.

An earlier draft of this measurement put break-even at "under 1 lookup per
session". That number priced the without-claude-db path as _the largest file
`git grep` touches_, which flatters the tool — you would open the file holding
the definition, not the biggest one in the result set. It also counted overhead
for a single prompt rather than a whole session. Priced against the defining
file, and against a full session's overhead, break-even moves from under 1 to
**6**.

## A. "Who uses this symbol, and how?"

WITH is one `usages --mode explain` call. WITHOUT is `git grep`, then opening
the file that defines the symbol to classify what the hits actually are.

The grep excludes `*.md` and `docs/`, so both sides see the same code. Without
that, writing this document inflated its own numbers — the prose mentions the
symbols it benchmarks.

```
--------------------------------------------------------------------------
  symbol                    WITH    grep   +read  WITHOUT
--------------------------------------------------------------------------
  isSearchable              1734    1228    1153     2381
  observationsFromTurns     2042    2362    7529     9891
  closeObservations         3209    1354    6597     7951
  flushSession              1786     818    4442     5260
  refreshGraph              2640    1143     961     2104
  observationId             2020    2418     572     2990
  toSnippet                 1994    1789     704     2493
  openWork                  1166    1294    1305     2599
--------------------------------------------------------------------------
  TOTAL chars              16591                    35669
  TOTAL tokens              4148                     8917
                                                     2.1x
```

**2.1x cheaper with the tool — 518 tokens per lookup against 1,115.**

The spread matters more than the average. `refreshGraph` and `observationId`
are _cheaper_ without, because their defining files are small; grep answers
those adequately. `observationsFromTurns` and `closeObservations` are 4-5x
cheaper with, because answering them by hand means reading a 200-line file, or
three of them across the store adapters.

So the win is not uniform. It concentrates on exactly the questions that span
files — which is also where a wrong answer costs the most.

## B. "Why is it like this?"

```
--------------------------------------------------------------------------
  question                                      WITH  WITHOUT
--------------------------------------------------------------------------
  why does capture read the transcript          1972     2508
  how does work get closed when a commit l      1597     1114
  what changed about find_usages                1797     2326
--------------------------------------------------------------------------
  TOTAL chars                                   5366     5948
  TOTAL tokens                                  1342     1487
```

Near enough to a wash, and the comparison is not honest in the tool's favour —
it is dishonest in the other direction. WITHOUT is `git log -S` plus one
`--stat`: that locates _what_ changed and never _why_. Reaching the reasoning
means reading diffs, and often the reasoning was never in a diff at all,
because it was said in conversation and not written down.

The real without-cost for this class of question is re-asking the person who
made the decision. That is unbounded and cannot be benchmarked, so it is left
out rather than guessed at. Read the wash above as a floor.

## C. Per session

It behaves like a subscription: a fixed cost every session, refunded a little
on each lookup.

```
--------------------------------------------------------------------------
  every session pays     3,600 tokens   (180/prompt x 20 prompts)
  every lookup refunds     597 tokens   (1115 without - 518 with)
  so it pays for itself at 6 lookups in a session

  lookups     claude-db  plain grep   you save
--------------------------------------------------------------------------
  0               3,600           0     -3,600
  2               4,636       2,230     -2,406
  5               6,190       5,575       -615
  10              8,780      11,150     +2,370
  20             13,960      22,300     +8,340
--------------------------------------------------------------------------
  negative = you paid more than you got back that session
```

The 3,600 is the recalled-context block on every prompt — ~180 tokens x 20
prompts — paid whether or not you ask a single code question. Each lookup hands
back the difference between doing it by hand and doing it in one call.

A session that never asks a code question is 3,600 tokens down. A session spent
refactoring, where every rename wants a blast-radius check, clears the line
early and keeps saving after it.

## What this means

The tool is not a general token saving. It is a trade: a fixed subscription
against a variable discount, and it only pays when the session actually uses
it.

Three things follow.

1. **Usage rate is the whole ballgame.** At 6 calls in 564 the discount never
   arrives. Making the tool reached-for more often is worth more than any
   further cost reduction — the remaining cost levers are worth a few hundred
   tokens a session, while crossing break-even is worth thousands.
2. **Overhead should scale with use.** A session that never queries should not
   pay 3,600 tokens. The block is already suppressed when everything matching
   is in context; suppressing it when nothing matches _well_ needs a relevance
   signal the RRF-fused score cannot provide, since it ranks by position rather
   than by match quality.
3. **Correctness is a token feature.** An answer that gets re-verified by hand
   costs the tool call _and_ the grep _and_ the read. The four graph bugs fixed
   in 0.5.3 were each a reason to re-check output, which is where the tokens
   actually went.
