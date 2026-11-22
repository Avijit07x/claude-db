# Plan: a start block with nothing twice (item 4.6)

Status: plan, checked against the code and a seeded run. Nothing is coded.

Goal: Claude sees each thing once, at chat start and after it, and nothing it does not need.

## What repeats today

Seen in real output from a seeded temp home on the current build, unless marked "code".

| #   | What repeats                                                                                     | Cause                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 1   | With no facts, the legacy and recent blocks both print. One chat's titles appear three times     | `session-start.ts:95-101` builds both, and keeps the legacy block whenever it has memory                              |
| 2   | A chat summary repeats its own turn lines, and its parts run together with no separator          | `last-chat.ts:61` drops a summary only if every part is shown. `toSnippet` removes the `" \| "`                       |
| 3   | "Not committed" repeats work already listed as a turn, a handoff line and a to-do                | `start.ts:54` filters by id only. Open-work lines carry no id, so they are not marked shown either                    |
| 4   | After `/compact`, "Earlier in this chat" and "Where you stopped" can list the same open work     | The filter for the compact block is by id only (the seed staged two rows with one title)                              |
| 5   | A legacy rule shown at start comes back in the next prompt's pick                                | `session-start.ts:96` marks only the facts and recent ids as shown                                                    |
| 6   | Every start ends with lines Claude does not need                                                 | The MCP hint repeats the server instructions. The scan hint and update notice are for the user. Then `(context ≈ N tokens)` |

Sizes on the seeded data: 458 tokens with facts, about 16% repeated lines. 351 tokens without facts, about 38%
repeated. 520 tokens after a compact.

## Root cause

Three builders (`startFacts`, `recentWorkBlock`, `legacyBlock`) make one start block, and repeats are filtered
by id. The same thing reaches the block as different rows: a turn, a summary, an open-work row, a handoff line
and a to-do. A filter by id cannot see that they match.

## Changes

1. **One builder.** `startFacts` no longer returns null when there are no facts. Empty sections drop out.
   - Delete `legacyBlock` (`src/hooks/start-legacy.ts`), `recentWorkBlock`, and the `fallback` logic in
     `session-start.ts`.
   - The legacy block's open work is already under "Where you stopped".
   - Its rules from chats (kind `preference`, newest first, manual first, up to 8) move into the one builder.
     They show when the project has no rule facts, because facts distill those rules when Haiku runs. Today
     they show only when there are no facts of any kind, so one "about you" fact, which is shared across
     projects, hides them everywhere.
   - Older chat summaries beyond the recent chats are no longer shown at start. `search` and the pick still
     find them.
   - Delete the `inject.sessions` setting, which only the legacy block read. An old config that has it still
     loads.
2. **One text filter for the whole block.** Skip a line whose text, lowercased with spaces collapsed, was
   already printed. It covers all sections, and the compact block's lines too.
3. **Summaries show only their unshown parts,** joined with `"; "`.
4. **Open-work lines carry their id** (`start.ts:73` passes `null` today), so they are marked shown and the pick
   does not repeat them.
5. **Hints.**
   - Drop the MCP hint.
   - Send the scan hint and the update notice to `systemMessage`, with the distill notice, through
     `emitSessionStart`. The user sees them, Claude does not.
   - Drop the `(context ≈ N tokens)` line from the start block and the per-prompt block.
     `scripts/unit/isolated/pick-run.mjs:208` checks for it and changes with it.

## Not changing

- `/catchup` repeats the start block on purpose, because the user asked for it.
- Claude's own memory files stay hidden at start, because Claude Code already loads them.
- After `/compact` the facts and rules are sent again on purpose, because the compact summary may drop them.

## Measure

- Before and after on the seeded data: total characters, and the count of repeated lines.
- Before and after on a copy of the real memory database in a temp home, `main`'s build against this branch's.
  Ask first, because it reads a copy of the user's private memory.

## Done when

- A test seeds chats, facts, a handoff, to-dos and open work, then runs session-start for startup, for a chat
  with no facts, and for compact. No line is printed twice, and the next pick returns no id shown at start.
- The existing start, compact and pick tests pass, updated where they expected the legacy block.
- `npm run typecheck`, `npm run lint` and `npm test` pass.
