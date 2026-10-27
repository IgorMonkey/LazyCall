# Releasing LazyCall

[Русский](RELEASING.ru.md) · [GitHub Flow and versions](DEVELOPMENT_WORKFLOW.md)

Releases are selected and published by the maintainer. The build workflow prepares artifacts with read-only repository permissions; it never publishes or merges automatically.

## Prepare a candidate

1. Use a reviewed, clean commit on `main`. Set the exact SemVer in `package.json`; use `yarn install` to refresh `yarn.lock` when needed. Run `yarn install --immutable`, `yarn build`, `yarn test`, and the relevant UI and packaged checks. Windows CI must pass.
2. Build public assets with the matching GitHub feed. Follow [BUILD.md](BUILD.md). Public assets exclude bundled Codex and app-local Microsoft VC DLLs; the installer offers the official Microsoft prerequisite if needed.
3. Use synthetic meeting and project data in screenshots. Check assets and logs for private content, credentials, and local paths.
4. Create an annotated `v<version>` tag at this exact source commit. Never move a published tag or replace published assets.

The **Prepare release review artifacts** workflow accepts the tag and its exact commit/ref. It verifies their identity, uses pinned Yarn, runs checks, creates the public stage and web/full installers, and stores review artifacts for 14 days. It has no publication permission.

## Publish a draft

Create a draft GitHub prerelease for alpha/beta/rc versions. Upload these canonical filenames for `0.3.5-alpha.1`:

- `LazyCall-Web-Setup-0.3.5-alpha.1.exe` — small bootstrap.
- `LazyCall-Setup-0.3.5-alpha.1.exe` — full installer.
- `lazycall-0.3.5-alpha.1-x64.nsis.7z` — bootstrap payload.
- `alpha.yml` — update metadata for the full installer.
- `SHA256SUMS.txt` — hashes using those exact asset names.

Verify the payload URL embedded in the bootstrap, its pinned hash, the full installer's SHA-512 in `alpha.yml`, all SHA-256 sums, asset sizes, and the tagged commit. Finish uploads while the release is a draft. Publish only after review; immutable releases prevent changing the tag or assets afterward.

## Validation and limitations

Test isolated install, launch, download failure, corrupt payload, retry, and uninstall. Verify failures leave an existing installation untouched. Test Codex-found and Codex-missing onboarding. Check user-data compatibility before an upgrade, and prevent installation during recording.

The first public alpha was checked locally for those installer paths and packaged application behaviour. A clean Windows machine without Microsoft VC Runtime and an actual upgrade from an older public release have not yet been verified. The updater driver and GitHub-provider protocol were exercised with local fixtures; an actual published-GitHub update installation remains unverified. Keep these limits in the release notes, alongside the unsigned-build notice. A full stable release needs clean-machine and real upgrade evidence.

## Repository settings

[repository-settings.json](../.github/repository-settings.json) records the intended setup; editing it does not apply settings. Verify required Windows CI and pull requests on `main`, no force push/deletion, squash merges, no auto-merge, private vulnerability reporting, and immutable releases in GitHub itself. The maintainer decides which PRs to merge and which candidates to release.
