# Memory MCP — token economics

Measured 2026-08-19 on this session's own transcript
(`~/.claude/projects/-Users-user-Personal-claude-db/b7603c72….jsonl`), so these are
observed numbers rather than estimates. Token figures are `chars / 4`.

Companion to [mcp-findings.md](./mcp-findings.md), which covers the four
correctness bugs. The last section here explains why those two documents are the
same problem.

## Summary

|     | Change                                               | Saving                         | Status                                       |
| --- | ---------------------------------------------------- | ------------------------------ | -------------------------------------------- |
| 0   | Skip observations the session has already been shown | **56% of injection, measured** | shipped 0.5.3                                |
| 1   | Gate injection on a `minScore` threshold             | —                              | **cannot work as specified, see below**      |
| 2   | Default `expandTop: 0`, render the snippet instead   | **67% of the block, measured** | shipped 0.5.3                                |
| 3   | Drop duplicate graph edges                           | 13% of every `explain`         | shipped 0.5.3, **in the opposite direction** |
| 4   | `get_observations` default `chars` 2000 → ~800       | priciest call, 539 avg         | open                                         |

Both **0** and **2** shipped in 0.5.3. Measured on four real prompts:

```
  1499 ->  520   "so now how we are saving tokens"
  1604 ->  577   "why does capture read the transcript"
  1541 ->  510   "postgres status column bug"
  1596 ->  480   "fix the compaction summary bug"
  ----------------------------------------------
  6240 -> 2087   67% cut
```

The index line now carries the matched snippet (110 chars, capped) in place of
the full body (900), so the block still shows _why_ something matched and still
names the id to expand. One caveat found while shipping it: existing installs
write every config value to disk, so changing a schema default reaches nobody
who already installed. A saved `inject` block still holding both old defaults
exactly is now treated as untouched.

### Cross-session numbers

The single-session figures below are a small sample. Replaying all 25 transcripts
for this project (`node scripts/bench-tokens.mjs`):

```
  project-memory      51x    20,267 chars   avg   397
  recalled-memory    142x   166,325 chars   avg 1,171
  TOTAL              193x   186,592 chars   ~46,600 tokens
                                            ~1,866 tokens/session (pre-0.5.3)
```

Of the per-prompt block, **56% was content the conversation already held** —
the same observations re-injected prompt after prompt, because the best match
for one prompt is usually the best match for the next. Replaying the 0.5.3
filter over the same history: 39 of 141 blocks suppressed entirely, 94,944 chars
saved, per-session cost `1,866 -> ~940`.

## Where the tokens went

53 tool calls, ~9,638 tokens of tool results:

| Tool               | Calls | Total tok | Avg tok/call |
| ------------------ | ----: | --------: | -----------: |
| Bash               |    33 |     5,351 |          162 |
| `find_usages`      |    11 |     2,053 |          187 |
| `get_observations` |     3 |     1,618 |      **539** |
| `search`           |     3 |       604 |          201 |
| `timeline`         |     2 |        13 |            6 |

Memory MCP was 19 of 53 calls (35.8%). That number is not representative — testing
the MCP _was_ the task. The prior measurement in observation `3f97c5fc-89bd` found
**6 of 564 calls (1.1%)** on a normal working session, against 148 hand-run greps.
Treat 1.1% as the realistic baseline and 35.8% as a ceiling.

## The largest cost is the injection nobody asked for

Per-call costs above are modest. The bigger line item is what the tool spends
**without being called**:

```
<recalled-memory> injections : 9
total                        : ~3,589 tokens
average                      : ~399 tokens per prompt
```

That is ~84% of what all 19 explicit MCP calls cost combined, spent automatically.

**How much of it was used.** Four observations were expanded this session:
`62bdadf3`, `3df47f53`, `fc7fc5c9` came from searches deliberately run; only
`3f97c5fc` came from an injection. So **1 of 9 injections (~11%) produced context
that was actually used** — roughly 3,190 tokens spent to deliver ~400 useful ones.

### Why: there is no relevance gate

`src/hooks/user-prompt.ts:26-44` filters on prompt shape and on
already-shown ids, and never on score:

```ts
if (!ctx.config.inject.perPrompt || !isSearchable(prompt)) return;
const shown = readShown(sessionId);
const found = await ctx.search.search({ text: prompt, project, limit: ... });
const entries = found.filter((entry) => !shown.has(entry.id));
if (entries.length === 0) return;
const toExpand = entries.slice(0, ctx.config.inject.expandTop);
```

`entry.score` is never consulted. Whatever fuse ranking returns gets injected, and
the top hit gets its body expanded, however weak the match. Prompts like
_"write these in a md file"_ still retrieve something and still pay full price.

Defaults (`src/config/schema.ts:30-33`) put the ceiling at ~1,400 chars ≈ 350 tokens
per prompt, which matches the measured 399:

```ts
promptResults: 4; // index lines retrieved
promptMaxChars: 500; // budget for those lines
expandTop: 1; // bodies fully expanded
expandMaxChars: 900; // chars per expanded body
```

### The `shown` dedup makes quality fall over a session

_(This critique lands. It is the strongest argument for pairing the dedup with a
real relevance gate — see 1 below for why the obvious gate does not work.)_

`entries.filter((entry) => !shown.has(entry.id))` excludes anything already injected.
Once the genuinely relevant observations have been shown, later prompts necessarily
inject **weaker** matches — while the token cost stays flat. The longer the session,
the worse the value, which is the opposite of what you want.

## Savings, in order of size

**1. Gate injection on score — does not work as written.** The instinct is right
and the saving would be real, but `entry.score` cannot carry the threshold.

`src/search/rank.ts:11` fuses with RRF, whose contribution is `1 / (60 + rank)` —
a function of **rank position only**, never of match quality. There is always a
rank 1, so the top hit always scores about `1/61` no matter how bad it is.

Measured, same database, `limit: 4`:

```
  0.029483  "why does capture read the transcript"   <- highly relevant
  0.029787  "write these in a md file"               <- irrelevant, scores HIGHER
  0.031535  "postgres status column bug"             <- relevant
  0.000000  "zqxjv wombat parasol ngmi"              <- no hits at all
```

The irrelevant prompt outscores the relevant one. Any `minScore` on this number
keeps the junk and drops the good, or suppresses everything. The one case it
does handle — total nonsense — already self-suppresses by returning zero rows.

A working gate has to read a signal that _is_ a relevance measure: the
pre-fusion bm25 or cosine score, or plain term overlap between the prompt and
the matched title. `src/search/service.ts:43` already thresholds vector
candidates on `embedder.minRelevance`, which is a real cosine cutoff — threading
that signal through the fuse is the shape of the fix. Calibration is the work;
the config knob is the easy part.

**2. Make `expandTop: 0` the default.** The expanded body is the bulk of the 399
(up to 900 of ~1,400 chars). The index line alone — id, kind, date, title, snippet —
is enough to decide whether to call `get_observations`, which is exactly the
three-layer design the tool already documents. Expanding by default pre-pays layer 3
on every prompt for a 1-in-9 chance of needing it. Roughly **halves** injection cost
on its own, and unlike (1) it is a one-line config change.

**3. Duplicate graph edges — fixed, but not by dropping the INFERRED row.**
Finding 4 above, measured:

```
explain flushSession        : 523 tokens
duplicate INFERRED-0.85 rows: 4 rows, 70 tokens = 13% of output
```

13% of every `explain` result is the same call listed a second time under a
lower-confidence bare name. The waste is real; the proposed fix was backwards.

Checking which of the pair actually resolves:

```
  EXTRACTED  ctx.store.insertObservations   resolves to a symbol: no
  INFERRED   insertObservations             resolves to a symbol: YES
```

The qualified name is a dead label — no store defines a symbol called
`ctx.store.insertObservations`. The bare INFERRED row is the only one carrying a
traversable target, so dropping it would have severed every `path` that crosses a
method call. 0.5.3 **merges** the pair instead: the qualified name is kept for
reading, the resolved id adopted for traversal. One row, honest label, working
`path`.

**4. Lower the `get_observations` default.** At 539 avg tokens it is the most
expensive call in the set, driven by `chars: 2000`. Most expansions need a paragraph.
Dropping the default to ~800 with the existing `… N more characters` marker keeps
the escape hatch and cuts the common case; the marker already tells the caller when
to ask for more.

## The other direction: what it saves when actually used

Worth stating plainly, because the items above are all about cost and the tool's
value is real.

`find_usages --mode usages` costs ~187 tokens and returns the definition, every
reference, and the relation type per reference, in one call. Reconstructing that with
grep takes several calls — the grep, then reading each site to classify whether it is
a call, an import, or an inherit. Establishing the finding-2 result by hand in this
session (`grep`, then `sed` over three call sites) cost roughly 500 tokens to reach
an answer one `usages` call would have given for 187 — except that in this instance
the graph had the wrong answer, which is why finding 2 matters for token cost too:
**a tool that is cheaper per call only saves tokens if its answer is trusted enough
not to be re-verified.**

That is the real relationship between the two halves of this document. The prior
session's 1.1% usage rate traced back to a single early failure
(observation `3f97c5fc-89bd`: one `is not inside a git working tree` error, then 392
consecutive calls without touching the tool). Findings 1-4 are each a reason to
re-verify output by hand, and hand-verification is where the tokens actually go.
