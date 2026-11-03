# Releasing LazyCall

[Русский](RELEASING.ru.md) · [GitHub Flow and versions](DEVELOPMENT_WORKFLOW.md)

Releases are selected and published by the maintainer. The build workflow prepares artifacts with read-only repository permissions; it never publishes or merges automatically.

## Prepare a candidate

1. Use a reviewed, clean commit on `main`. Set the exact SemVer in `package.json`; use `yarn install` to refresh `yarn.lock` when needed. Run `yarn install --immutable`, `yarn build`, `yarn test`, and the relevant UI and packaged checks. Windows CI must pass.
2. Build public assets with the matching GitHub feed. Follow [BUILD.md](BUILD.md). Public assets exclude bundled Codex and app-local Microsoft VC DLLs; the installer offers the official Microsoft prerequisite if needed.
3. Use synthetic meeting and project data in screenshots. Check assets and logs for private content, credentials, and local paths.
4. Create an annotated `v<version>` tag at this exact source commit. Never move a published tag or replace published assets.

The **Prepare release review artifacts** workflow requires an exact 40-character source commit SHA. Supply the release tag to verify its version and commit identity; omit the tag when reviewing dependency or build changes before a release. Untagged runs do not create tags or releases. The workflow uses pinned Yarn, runs checks, creates the public stage and web/full installers, and stores review artifacts for 14 days under the tag or source SHA. It has no publication permission.

## Publish a draft

Create a draft GitHub Release. A plain version such as `0.3.7` is a regular release; use the prerelease flag only for a deliberately suffixed version. Upload these canonical filenames for `0.3.7`:

- `LazyCall-Web-Setup-0.3.7.exe` — small bootstrap.
- `LazyCall-Setup-0.3.7.exe` — full installer.
- `lazycall-0.3.7-x64.nsis.7z` — bootstrap payload.
- `latest.yml` — update metadata for the full installer.
- `SHA256SUMS.txt` — hashes using those exact asset names.

Verify the payload URL embedded in the bootstrap, its pinned hash, the full installer's SHA-512 in `latest.yml`, all SHA-256 sums, asset sizes, and the tagged commit. Finish uploads while the release is a draft. Publish only after review; immutable releases prevent changing the tag or assets afterward.

## Validation and limitations

Test isolated install, launch, download failure, corrupt payload, retry, and uninstall. Verify failures leave an existing installation untouched. Test Codex-found and Codex-missing onboarding. Check user-data compatibility before an upgrade, and prevent installation during recording.

The first public release was checked locally for those installer paths and packaged application behaviour. The updater driver and GitHub-provider protocol were also exercised with local fixtures.

On 2026-11-03, the installed, published 0.3.6 app discovered and downloaded 0.3.7 through its embedded GitHub feed. The in-app install button launched the published NSIS installer, which upgraded the existing per-user installation. Starting 0.3.7 then reported that it was up to date. A synthetic project, meeting goal, saved meeting, note, confirmed task, and settings were preserved; all five application-data files were byte-identical. This covered one existing Windows machine with Microsoft VC Runtime already installed and a separate test profile. The interactive installer required language selection and installation confirmations; this was not a silent upgrade.

A clean Windows machine without Microsoft VC Runtime remains unverified. Keep that limit and the unsigned-build notice in release notes; this single-machine upgrade check is not a broad compatibility claim.

## Repository settings

[repository-settings.json](../.github/repository-settings.json) records the intended setup; editing it does not apply settings. Verify required Windows CI and pull requests on `main`, no force push/deletion, squash merges, no auto-merge, private vulnerability reporting, and immutable releases in GitHub itself. The maintainer decides which PRs to merge and which candidates to release.

## Download and repository metrics

Run `node scripts/release-stats.cjs` with an authenticated GitHub CLI to see published installer counters. Add `--traffic` for repository visits and clones (push access required, rolling 14-day window), or `--json` for a machine-readable snapshot. For local history, save the JSON under the ignored `test-results/` directory. Run it periodically yourself when needed; no schedule or app telemetry is enabled.

The bootstrap, full installer, and web payload are separate rows. Do not add bootstrap and payload downloads as users. Repeat downloads and updates can affect counters; these metrics cannot tell you completed installations, active users, or retention. The command only reads GitHub aggregate data and does not contact a running LazyCall app.
