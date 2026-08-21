## What this changes

<!-- What the change does, and why. Link the issue if there is one. -->

## How it was verified

<!--
What you ran, and what it showed. Numbers beat adjectives: a replay count, a
before/after, a timing. Say plainly what you did not cover.
-->

## Checklist

- [ ] `npm run typecheck` is clean
- [ ] `npm run build` succeeds
- [ ] `npm test` passes
- [ ] `npm run format:check` passes
- [ ] a check exists that fails without this change
- [ ] `CHANGELOG.md` updated, if this is user-visible
- [ ] no comments added to the code (repo convention — explain it here instead)

<!--
Touching src/store/? The `adapters` CI job runs real Postgres and MongoDB and
is the only verification those two backends get. Wait for it before merging.

Touching src/graph/languages/ or extraction? Bump SCAN_VERSION in
src/graph/scan/files.ts so existing users reparse instead of being served a
graph built by the old rules.
-->
