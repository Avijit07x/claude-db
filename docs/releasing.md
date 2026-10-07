# Releasing

For maintainers.

Every release, patch or minor, goes through a branch and a pull request:

- **Patch** (`0.7.1`): branch `v0.7.1`.
- **Minor** (`0.8.0`): branch `v0.8`.

Then:

1. The feature commits.
2. A separate `docs: changelog for <version>` commit, `CHANGELOG.md` only.
3. A separate version commit that bumps both `package.json` and `package-lock.json`.
4. Open a pull request, wait for CI and the `adapters` job, and merge it with a merge commit, not a squash.
5. From `main`, an annotated tag: `git tag -a v0.8.0 -m "0.8.0"`. A lightweight tag is never pushed.
6. Push the tag with `git push origin refs/tags/v0.8.0`, which runs `publish.yml`. Name it in full, because a
   patch branch has the same name as its tag.

`publish.yml` refuses to publish when the tag and `package.json` disagree. npm never accepts the same version
twice.

## Grammar packages

`publish.yml` first publishes one grammar package per platform, `claude-db-grammars-<platform>`, at the
same version, and then claude-db, which lists them as optional dependencies. A package already on npm is
skipped, so a failed run can be repeated. The `NPM_TOKEN` secret must be allowed to publish all five.
