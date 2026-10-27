# Releasing LazyCall

[Русский](RELEASING.ru.md)

This is a review procedure, not a publishing procedure. The current candidate is `v0.3.5-alpha.1`; it remains a pre-release until a maintainer explicitly reviews the artifacts and publishes it.

## Before dispatching the workflow

1. Use a clean, reviewed commit on `main` and set `package.json` to the exact semantic pre-release version, for example `0.3.5-alpha.1`.
2. Create `v0.3.5-alpha.1` at that exact commit. The manual workflow rejects a tag that does not equal `v` plus the package version, or a tag that resolves to another commit.
3. Review the public data boundary: use synthetic transcripts and project names in screenshots and test evidence. Do not put a real meeting, private repository content, credentials, or user data in artifacts or release notes.
4. Keep the existing LazyCall icon and name. Do not introduce an unreviewed logo or rebrand while preparing a release.

## Prepare review artifacts

Run **Prepare release review artifacts** with both explicit inputs:

- `tag`: `v0.3.5-alpha.1`
- `ref`: the tagged commit SHA, or the tag itself

The Windows workflow checks out that ref, verifies the tag and package version, runs `npm ci`, build and tests, downloads the pinned local speech runtime, and creates the light public stage. `CALLME_RELEASE_REPOSITORY` is set to `github.repository` before staging, so the packaged app uses the reviewed repository identity.

It then runs the packaged public-light smoke, builds the web installer and full installer as review artifacts, writes `SHA256SUMS.txt`, and uploads an Actions artifact for 14 days. The workflow has read-only repository permission. It does not create a GitHub Release, upload release assets, publish a package, or enable updates.

## Alpha update feed

When `CALLME_RELEASE_REPOSITORY=IgorMonkey/LazyCall` is present before public staging, the stage writes a GitHub-provider feed for that exact owner and repository. The app enables prerelease lookup when its own semantic version contains a prerelease suffix, so `0.3.5-alpha.1` resolves the matching `alpha.yml` feed. A published update requires the full NSIS installer and its matching `alpha.yml`; do not publish either before the installer and update path have passed real end-to-end validation.

## Human release gate

Download the Actions artifact and inspect the installer names, SHA-256 sums, public-stage manifest, packaged-smoke report, and screenshots. Verify the preview label is visible where users would see the artifact, and that no test evidence contains private meeting or project data.

Before publishing, test a download on a clean Windows x64 machine: a successful install, checksum failure, Microsoft VC runtime download and installation, no-Codex onboarding, installed-Codex onboarding, uninstall, and upgrade from the previous compatible build. Review the data flows in [PRIVACY.md](PRIVACY.md) and the release notes. The online installer and automatic updates are not ready for public release until these checks are recorded and a maintainer explicitly publishes the assets.

## Repository setup review

[`.github/repository-settings.json`](../.github/repository-settings.json) is a manual plan for repository settings: `main` has the Windows CI check, force pushes and deletion are disabled, and no approval count is required for a single-maintainer project. Apply it in GitHub only after reviewing the plan; the file itself has no effect on GitHub.
