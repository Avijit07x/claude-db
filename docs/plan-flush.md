# Plan: a flush with no lock and no marker file (item 4.3)

Status: plan, checked against the code. Nothing is coded.

Goal: saving a chat stays correct and cheap with fewer moving parts. `src/capture/flush.ts` has had 12 fix
commits, and most of them came from the machinery below.

## Why the machinery exists

- **The newest turn is re-read on every flush.** The chat log has no end-of-turn marker, and a turn keeps
  growing until the next real prompt: task notifications, hand-backs and Stop re-fires all append to it
  (`scripts/unit/capture-turns.mjs`). That is why `nextOffset` stops at the newest turn's start
  (`src/capture/transcript.ts:68`). This stays.
- **Several triggers flush the same chat, and each one is needed:**
  - Stop: saves this turn now.
  - The next prompt: covers turns that never got a Stop, like an Esc interrupt, and gives the pick its
    `lastReply`.
  - SessionEnd: the last save, and the summary.
  - Compact: saves before "Earlier in this chat".
  - Repair and reingest: re-save old chats under new rules.
- **Repeats re-embed the newest turn,** which costs time. So the code grew `.written` hashes (37c45cf), a lock
  per chat with a lock-breaker (`src/capture/flush-lock.ts`, 3 fix commits), and a "never move the cursor back"
  guard (67740fd). Ids are content-addressed, so a repeat write was always safe (6e1ebc5).

## Root cause

The code needs to know whether a row changed, and it keeps that knowledge in side files guarded by a lock. The
stored row already knows.

## Change

1. **Compare with the stored rows.** `flushUnlocked` builds the observations as today, fetches the stored rows
   with `store.getObservations(ids)` (all three backends have it), and drops a row whose kind, title, body,
   files, tags and `createdAt` are equal. Only changed rows are embedded and written.
   - Fetch ids in chunks of 500, for a long catch-up.
   - Leave `project` out of the comparison. Stored rows hold the remote key and fresh rows hold the folder
     (`withProjectScope` keys on insert), and `project` never changes within one chat. Leave out `status` and
     the embedding too.
2. **Order:** session upsert, then rows, then cursor. A crash anywhere retries cleanly, and the summary fix from
   2.4 holds.
3. **Delete:**
   - `src/capture/flush-lock.ts` (119 lines), and `withFlushLock`, `FlushLockOptions` and `skipped`.
   - `.written` (`readWritten`, `writeWritten`, `printOf`) and the "never move back" guard in `advanceCursor`.
   - The lock options in `user-prompt.ts` and `session-end.ts`.
   - `scripts/unit/isolated/flush-lock-run.mjs`.
   - The prompt flush then never skips, so the pick always gets `lastReply`.
4. **Upgrade:** for one release, `sweepCursors` deletes old `.written`, `.lock` and `.lock.break` files. There is
   no schema change, and `.offset` files keep working.

## Edge cases

| Case                                  | What happens                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Turn still growing at Stop            | The cursor stays at the turn start. Each growth changes the row, so it is embedded once more   |
| Stop worker and next prompt together  | Both may embed the newest turn once. The write is idempotent                                   |
| An older snapshot written after a newer one | Possible only if the turn grows between two flushes that overlap. The next trigger fixes it |
| Crash between rows and cursor         | The retry finds equal rows and skips them                                                      |
| Cursor past the end of the log        | It restarts at 0, which is cheap now                                                           |
| Rebuild or reingest                   | The cursor resets to 0, every row is written, and the summary is rebuilt                       |

## Done when

- New tests: two flushes at once leave exactly the unique rows; a stale or zero cursor re-saves and re-embeds
  nothing; a crash after the session write still saves the rows on retry; old `.written` and `.lock` files are
  removed by the sweep.
- `scripts/unit/isolated/flush-run.mjs` drops its lock and `.written` checks. `chat-chain-run.mjs`,
  `session-end-run.mjs`, `capture-turns.mjs` and `scripts/transcript.mjs` pass unchanged.
- `npm run typecheck`, `npm run lint` and `npm test` pass.
