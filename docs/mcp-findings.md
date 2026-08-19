# Memory MCP — test findings

Tested 2026-08-19 against `/Users/user/Personal/claude-db` at `654a854`, using the
installed MCP server plus the `claude-db` CLI. All six tools exercised except the
`remember` / `forget` write path.

Four findings: one total feature outage, one that returns confidently wrong
answers, two that erode trust in output the caller cannot cross-check.

**All four are fixed in 0.5.3**, each with a regression test. The mechanisms are
kept below because they explain _why_ the graph was wrong, which the changelog
cannot. One correction: the fix proposed for finding 4 was backwards — see the
note at the end of that section.

| #   | Tool                         | Severity          | Summary                                                                 |
| --- | ---------------------------- | ----------------- | ----------------------------------------------------------------------- |
| 1   | `timeline`                   | **Broken**        | Cannot accept the ids the MCP itself displays                           |
| 2   | `find_usages --mode usages`  | **Wrong answers** | `Class.method()` is not counted as a reference to `Class`               |
| 3   | `find_usages --mode usages`  | Misleading        | Callers inside anonymous functions are named after a variable or a file |
| 4   | `find_usages --mode explain` | Noise             | Same call listed twice; destructuring patterns listed as symbols        |

## What works

No changes needed here, recorded so a later pass does not re-test it.

- **`search`** — snippet, `kind` filter, relevance ordering and short ids all behave.
  The layer-1 gaps raised in observation `fc7fc5c9-e078` (matched snippet, `chars`
  cap, relevance score) have all shipped.
- **`get_observations`** — batches, accepts short ids, honours `chars`, marks truncation.
- **`find_usages --mode text`** — live grep, never stale, `[definition?]` marker and
  `path` scoping all correct.
- **`find_usages --mode explain`** — rich and useful, modulo finding 4.

---

## 1. `timeline` cannot accept the ids the MCP shows

**Severity: broken.** Not degraded — the tool cannot succeed through the documented
workflow, because the only ids a caller ever sees are ids it rejects.

### The mechanism

`src/mcp/render.ts:10` renders every search row's id through `toShortId()`, which
slices a 36-char UUID down to 13 characters:

```ts
const head = `${toShortId(entry.id)} ${entry.kind} ${date} ${entry.title}`;
```

`src/hooks/relevance.ts:18,27` does the same for the memory injected at session
start. So a short id is the _only_ form of an id that reaches the model.

`get_observations` compensates — it routes ids through `partitionIds()`
(`src/util/shortid.ts:11`) and matches short ones with a `GLOB prefix*`.

`timeline` does not. Its anchor lookup is an exact match in all three adapters:

- `src/store/sqlite/search.ts:98` — `SELECT project, created_at FROM observations WHERE id = ?`
- `src/store/postgres/observations.ts:144` — `... WHERE id = $1`
- `src/store/mongo/search.ts:39` — `findOne({ _id: query.observationId })`

Every one is followed by `if (!anchor) return []`, so the failure surfaces as the
empty, plausible-looking message **"No matching observations."** rather than an error.

### Reproduce — via the MCP tools

```
search({ query: "turn extractor", limit: 5 })
  -> 62bdadf3-d472 decision 08-15 The instruction only fires ...

get_observations({ ids: ["62bdadf3-d472"] })
  -> returns the full observation                     OK

timeline({ observation_id: "62bdadf3-d472", before: 2, after: 2 })
  -> "No matching observations."                      BUG
```

### Reproduce — as a script

There is no `timeline` CLI subcommand (`src/cli/index.ts` registers 22 commands;
`timeline` is MCP-only), so this drives the library directly. Save at the repo root
(the relative imports resolve from the file, not the cwd) and run after `npm run build`:

```js
// repro-timeline.mjs
import { createContext } from './dist/context.js';
import { toShortId } from './dist/util/shortid.js';

const ctx = await createContext();
try {
  const [hit] = await ctx.search.search({
    text: 'turn extractor',
    project: '/Users/user/Personal/claude-db',
    limit: 1,
  });
  if (!hit) {
    console.log('no observations stored');
    process.exit(0);
  }

  const full = hit.id;
  const short = toShortId(full); // exactly what src/mcp/render.ts:10 shows the model

  console.log('full id          :', full);
  console.log('id the MCP shows :', short);
  console.log(
    'get_observations(short) ->',
    (await ctx.search.getObservations([short])).length,
    'row(s)  OK',
  );
  console.log(
    'timeline(full)          ->',
    (await ctx.search.timeline({ observationId: full, before: 2, after: 2 })).length,
    'row(s)  OK',
  );
  console.log(
    'timeline(short)         ->',
    (await ctx.search.timeline({ observationId: short, before: 2, after: 2 })).length,
    'row(s)  <-- BUG',
  );
} finally {
  await ctx.close();
}
```

Observed:

```
full id          : 9fff1197-19dc-a62c-16ad-0699071b2191
id the MCP shows : 9fff1197-19dc

get_observations(short) -> 1 row(s)  OK
timeline(full)          -> 5 row(s)  OK
timeline(short)         -> 0 row(s)  <-- BUG
```

### Why it was never caught

The single test at `scripts/smoke/retrieval.mjs:60` passes a full id read straight
back out of the store:

```js
const tl = await search.timeline({ observationId: observations[2].id, before: 2, after: 2 });
```

That is the one input shape no real caller ever produces. The test passes and the
feature has never worked over MCP.

### Fix

Resolve the id at the chokepoint. `src/search/service.ts:49` is the single point
both the MCP server (`src/mcp/server.ts:129`) and any future CLI route through, and
`getObservations` already implements correct prefix matching in all three adapters:

```ts
async timeline(query: TimelineQuery): Promise<ObservationIndexEntry[]> {
  const [anchor] = await this.store.getObservations([query.observationId]);
  if (!anchor) return [];
  return this.store.timeline({ ...query, observationId: anchor.id });
}
```

One file, three adapters fixed, no adapter-specific SQL touched. Then change
`scripts/smoke/retrieval.mjs:60` to feed `toShortId(observations[2].id)` so the
regression cannot come back.

---

## 2. `Class.method()` does not register as a reference to `Class`

**Severity: wrong answers.** This is worse than finding 1, because finding 1 fails
loudly-ish and this one silently under-reports a blast radius.

### The mechanism

A member call `X.method()` creates a graph edge to `method` (and to the qualified
name `X.method`), but never to `X`. So a class only ever constructed through a
static factory looks unreferenced.

This is precisely how every store backend in this project is wired, which makes it
the worst possible blind spot here: the pluggable-store seam is the product's
headline feature ("Bring your own database: SQLite, MongoDB or Postgres").

### Reproduce

```sh
node dist/cli/index.js usages --mode usages SqliteStore
node dist/cli/index.js usages --mode usages PostgresStore
```

Observed:

```
SqliteStore  [class]
  Source: src/store/sqlite/index.ts:40
  Referenced by (1):
    <-- create  [calls] [EXTRACTED]  src/store/sqlite/index.ts:48
```

The single reference is `new SqliteStore(...)` _inside the class's own static
`create`_. The real external caller is missed:

```sh
grep -rn "SqliteStore" src/
# src/store/index.ts:22:  const { SqliteStore } = await import('./sqlite/index.js');
# src/store/index.ts:23:  return SqliteStore.create(uri);   <-- never appears in the graph
```

So `find_usages --mode usages SqliteStore` answers **"nothing but itself"** when the
truth is that this line is the only thing that ever constructs it. Rename or delete
the class on that basis and the store factory breaks.

### Not the dynamic import

Worth recording, because it is the obvious wrong diagnosis. Dynamic `await import()`
is handled fine — both of these are found:

```sh
node dist/cli/index.js usages --mode usages LocalEmbedder
#  <-- loadLocal  src/embed/index.ts:26      (behind `await import('./local.js')`)
node dist/cli/index.js usages --mode usages refreshGraph
#  <-- refreshGraphQuietly  src/hooks/session-start.ts:24   (behind `await import(...)`)
```

The discriminator is the call shape, not the import:

| Call site                       | Shape                     | Found? |
| ------------------------------- | ------------------------- | ------ |
| `src/embed/index.ts:26`         | `new LocalEmbedder()`     | yes    |
| `src/hooks/session-start.ts:24` | `refreshGraph(...)`       | yes    |
| `src/store/index.ts:23`         | `SqliteStore.create(uri)` | **no** |

Bare constructor and bare call resolve; member call does not.

### Fix

When extracting a call whose callee is a member expression, emit an edge to the
object as well as to the property — `SqliteStore.create(uri)` should yield a
`calls` edge to `create` _and_ a `references` edge to `SqliteStore`. Confirm against
all three store classes, since all three use the same `X.create(uri)` shape.

---

## 3. Callers inside anonymous functions are named after a variable or a file

**Severity: misleading, not wrong.** The file and line are correct; the caller
_name_ is not a caller.

### Reproduce

```sh
node dist/cli/index.js usages --mode usages createContext
```

Observed:

```
  Referenced by (23):
    <-- cmdDoctor                    src/cli/commands/doctor.ts:12      correct
    <-- ctx                          src/hooks/session-end.ts:20        variable name
    <-- ctx                          src/hooks/session-start.ts:54      variable name
    <-- ctx                          src/hooks/user-prompt.ts:18        variable name
    <-- ctx                          src/mcp/server.ts:30               variable name
```

And on another symbol, the degradation goes one step further, to a filename:

```sh
node dist/cli/index.js usages --mode usages flushSession
```

```
    <-- cmdFlush                     src/cli/commands/maintain.ts:56    correct
    <-- result                       src/hooks/session-end.ts:23        assignment target
    <-- src/hooks/user-prompt.ts     src/hooks/user-prompt.ts:23        filename
```

### The mechanism

Attribution walks up to the nearest **named** enclosing function. When there is one
it is correct:

```ts
// src/cli/commands/doctor.ts:10  -> attributed to cmdDoctor, correct
export async function cmdDoctor(argv: (string | undefined)[]): Promise<void> {
  const ctx = await createContext({ ... });
```

When the enclosing scope is an anonymous callback there is no name to find, so it
falls back to the assigned variable, and with no assignment at all, to the file:

```ts
// src/hooks/session-end.ts:14  -> anonymous arrow, no name to walk up to
await runHook(async () => {
  const ctx = await createContext();          // :20  -> attributed to `ctx`
  const result = await flushSession(...);     // :23  -> attributed to `result`
});

// src/hooks/user-prompt.ts:23  -> no assignment either
await flushSession(ctx, sessionId, project, payload.transcript_path);
```

Every hook entry point in this codebase is an anonymous callback passed to
`runHook`, so the four most important call sites in the project — the actual
process entry points — are exactly the ones with meaningless caller names.

### Fix

When no named enclosing function exists, fall back to the enclosing _call_ being
passed to (`runHook`) or to a `file:scope` label, rather than to whatever binding
happens to be nearest. `<-- runHook` or `<-- session-end:hook` would both be honest;
`<-- ctx` is not.

---

## 4. `explain` lists the same call twice and lists non-symbols

**Severity: noise.** Inflates edge counts and makes the output harder to scan.

### Reproduce

```sh
node dist/cli/index.js usages --mode explain flushSession
```

Observed — one call, two rows, twice over:

```
    --> ctx.store.insertObservations  [calls] [EXTRACTED]        src/capture/flush.ts:39
    --> insertObservations            [calls] [INFERRED 0.85]    src/capture/flush.ts:39   same call
    --> Date.now                      [calls] [EXTRACTED]        src/capture/flush.ts:46
    --> now                           [calls] [INFERRED 0.85]    src/capture/flush.ts:46   same call
```

Same file, same line, same call — counted once as the qualified member expression
and again as a lower-confidence bare-name inference. `ctx.store.getSession` /
`getSession` and `ctx.store.upsertSession` / `upsertSession` duplicate the same way.

Separately, destructuring patterns are stored as symbol names:

```
    --> { turns, nextOffset }  [defines] [EXTRACTED]  src/capture/flush.ts:25
```

Between them these inflate the reported `Reaches (24)` to roughly 18 genuine edges.

### Fix — as shipped, and why not as proposed

The proposal below was to drop the INFERRED row because "the qualified name is
strictly better information". Checked before applying:

```
  EXTRACTED  ctx.store.insertObservations   resolves to a symbol: no
  INFERRED   insertObservations             resolves to a symbol: YES
```

Nothing defines a symbol named `ctx.store.insertObservations`, so the qualified
row is a dead label and the bare row is the only traversable one. Dropping it
would have severed every `path` crossing a method call. 0.5.3 **merges** the
pair — qualified name kept for reading, resolved id adopted for traversal.

Original proposal, kept for the record:

- Drop an INFERRED edge when an EXTRACTED edge already exists for the same
  `(file, line, target)`. The qualified name is strictly better information.
- Expand a destructuring pattern into one `defines` edge per bound name
  (`turns`, `nextOffset`), or skip it — storing the pattern source text as a symbol
  helps nobody.

---

## Suggested order

1. **Finding 1** — smallest fix (~6 lines, one file), restores a tool that has never worked over MCP.
2. **Finding 2** — quietly wrong blast-radius answers are more dangerous than no answer; a rename based on this output breaks the store factory.
3. **Findings 3 and 4** — cosmetic individually, but together they are most of what makes graph output hard to trust when you cannot cross-check it.

## Not covered

`remember` and `forget` were not exercised, since both write to the live memory
database and `forget` is irreversible by its own contract. Worth a round-trip test
against a scratch database before the next release.

---

## See also

[token-economics.md](./token-economics.md) — measured token cost of this MCP,
where it is spent without being asked, and four changes that cut it. Findings 1-4
above are also token findings: each one is a reason to re-verify output by hand,
and hand-verification is where the tokens go.
