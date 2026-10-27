# Development workflow

[Русский](DEVELOPMENT_WORKFLOW.ru.md)

LazyCall uses GitHub Flow: `main` is the shared integration branch and work happens in short-lived branches. There is no `develop` branch and no release branch at this stage.

## Branches and pull requests

Create a branch from current `main`, use a focused pull request, and delete the branch after it is merged.

- Use `feat/...`, `fix/...`, or `docs/...` for normal work. `refactor/...`, `test/...`, `build/...`, `ci/...`, and `chore/...` are also appropriate when they describe the change.
- Work performed by a coding agent uses `codex/...` as its branch prefix.
- A pull request must pass **Build and test on Windows** before merge. It is squash-merged into `main`; do not merge a branch that has unrelated changes or an unresolved review concern.
- Dependabot pull requests are exempt from the human branch-name and Conventional Commit title conventions. Their CI is still required, and they are never auto-merged by this policy. A maintainer decides whether to merge every pull request.

Use a Conventional Commit-style PR title: `feat:`, `fix:`, `docs:`, `refactor:`, `perf:`, `test:`, `build:`, `ci:`, or `chore:`. Mark a breaking change with `!` after the type, for example `feat!: replace meeting export schema`, or include a `BREAKING CHANGE:` section in the PR body. The PR explains the user impact, verification, and any migration steps.

This is a project convention layered on the GitHub Flow model; see the [GitHub Flow guide](https://docs.github.com/en/get-started/using-github/github-flow).

## Versions and release train

`package.json` is the single source of truth for the application version. A release tag is exactly `v<package.json version>` and points at the exact commit whose assets are released.

The first public train is `0.3.5-alpha.1`. The older `0.3.4` builds were local previews, which is why the public line does not start at `0.1`. The intended sequence is:

```text
0.3.5-alpha.1 → 0.3.5-alpha.2 → … → 0.3.5-beta.1 → … → 0.3.5-rc.1 → … → 0.3.5
```

Fixes during the train advance the prerelease number, for example `0.3.5-alpha.2`. After stable `0.3.5`, a compatible fix is `0.3.6`; a compatible feature is `0.4.0`. While the major version is zero, a breaking change advances the minor version as well and must carry explicit migration notes, for example `0.4.0` after `0.3.x`. From `1.0.0` onward, use SemVer majors for breaking changes, minors for backward-compatible features, and patches for backward-compatible fixes.

Compatibility covers user projects, saved settings, transcripts, exports, and the provider contract—not only source-code APIs. A change that makes one of those unreadable, changes its meaning, or silently changes provider behavior is breaking unless a documented compatible migration exists.

The package version, PR title, release-tag check, and Windows CI make these conventions reviewable. They do not publish anything automatically: the manual release workflow produces review artifacts only. A maintainer manually publishes the GitHub Release from the exact tagged commit after review, with the matching assets and `SHA256SUMS.txt`. Published tags and assets are immutable: do not retag, replace, or overwrite them; publish a corrective version instead.

Version interpretation follows the [Semantic Versioning 2.0.0 specification](https://semver.org/spec/v2.0.0.html).
