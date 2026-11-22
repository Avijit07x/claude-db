# Plan: measure the search ranking, then keep or drop vectors (item 4.2)

Status: steps 1 and 2 are done (c1b4c95, e450778). Step 3, the owner's run, decides.

Goal: the ten notes the picker sees, and the order `search` shows, hold the useful memory. The code stays
only if it earns its place.

## What the code does

- **Keyword and vector results are fused by RRF,** with k = 60 (`src/search/rank.ts:3`). Then a recency
  multiplier of 0.7 to 1.0 is applied, with a 45-day half-life (`rank.ts:26-33`).
- **The built-in embedder is a hashed bag of words** (`src/embed/builtin.ts:23-28`). A probe gave 0.93 cosine for
  "should" against "should not enable caching", and 0.07 for the same meaning in other words. So it is a second
  keyword signal, not meaning.
- **Its 0.18 floor passes most hits.** On a docs probe, 383 of 450 hits passed.

## Problems

| #   | Problem                                                                                                                                        | Checked |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | Recency outweighs rank. RRF ranks 1 and 10 differ by 13%, recency by up to 30%. A fresh 10th result beats a 60-day-old 1st                     | code    |
| 2   | Recency uses `Date.now()`, not `query.until` (`src/search/service.ts:31`). A replay run decays from the wrong time                             | code    |
| 3   | Nothing measures ranking quality. The labelled-pair numbers came from a script that is not in the repo                                          | code    |

Recency runs after the cut to `limit`, so it only reorders the ten candidates. It changes the strict top-1
fallback and the order `search` shows. It does not change which ten notes the picker sees.

## Changes

1. **Fix problem 2.** `applyRecencyBoost(fused, query.until ?? Date.now())`. Production does not set `until`,
   so it is unchanged. Test: a replay at a past time ranks as it did then.
2. **Add `--compare-rank` to `scripts/bench-inject.mjs`.**
   - For each replayed prompt, build four lists of ten: fused (today), fused without recency, keyword only,
     and keyword re-sorted by words shared with the prompt (`overlapCount`, `src/hooks/relevance.ts:14`).
   - Judge the union once, two passes. A pair is useful when both passes agree.
   - `replay` (`scripts/lib/replay.mjs`) returns every prompt's candidates, not only those past the gate.
   - Scripts only. No change to `src/` beyond step 1.
3. **The owner runs it on a frozen copy of their data,** with nothing sent anywhere but the judge:
   `npm run bench:inject -- <project> --last 300 --no-pick --judge --compare-rank`. Use `CLAUDE_CONFIG_DIR`
   and `CLAUDE_DB_URL` pointing at the copy.

## Decision rule

The run prints, per list: prompts with at least one useful note in the ten, precision at 3, and the AUC of list
position. Each comes with a 95% interval over prompts.

- **Keep vectors** only if fused beats "keyword plus shared words" by at least 5 points of prompts with a useful
  note and 0.03 AUC, with both intervals above zero.
- **Otherwise remove the vector stack** in its own plan: about 900 source and 250 test lines, the
  `@xenova/transformers` peer dependency, `reembed`, and `embeddings` in the config.
  - Leave the Postgres `embedding` column, its index and the extension in place, because other machines on
    older versions still use them. Delete `migrateVectorDims`, which drops that shared column for everyone.
  - Leave the SQLite column. Old config keys load as before.
- **Recency:** keep the multiplier only if "fused without recency" is not better.

## Done when

- Step 1 has a test, and `npm test` passes.
- `--compare-rank` runs end to end on seeded data in a temp home (a mechanics check, not evidence).
- The owner's run is in, and the keep-or-remove decision is written here as one line.
