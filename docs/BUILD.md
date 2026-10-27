# Building LazyCall

[Русский](BUILD.ru.md)

This guide describes the current Windows x64 public-review pipeline for version `0.3.5-alpha.1`. It creates review artifacts only; it does not publish a GitHub Release or make an update available to users.

## Development checks

Use Windows x64, Node.js 24 LTS, and npm.

```powershell
npm ci
npm run build
npm test
```

These checks do not need a ChatGPT login, real meeting data, a microphone, or a cloud-model call.

## Public-review stage

Create the fresh light staging folder with:

```powershell
npm run pack:public
```

It writes `release/public-review/win-unpacked` for the current app version. This stage deliberately excludes bundled Codex and the four app-local Microsoft VC runtime DLLs. It keeps the local Whisper model and CPU/CUDA binaries. LazyCall instead discovers a native installed Codex CLI or lets the user choose `codex.exe`; the web installer obtains the approved Microsoft VC runtime during installation.

Validate this stage before making an installer. The packaged smoke uses an isolated user-data directory, a synthetic WAV, and stubbed external launches:

```powershell
$env:CALLME_PACKAGED_EXE = (Resolve-Path 'release/public-review/win-unpacked/LazyCall.exe').Path
$env:CALLME_PUBLIC_LIGHT = '1'
node scripts/check-packaged.cjs
```

The local public-review stage, installed-Codex flow, and English/Russian UI have been exercised in this environment. That is not a claim that the online installer is ready for general distribution.

## Local web-installer preview

Build a loopback-only installer and payload:

```powershell
npm run dist:web -- --prepackaged release/public-review/win-unpacked --local-preview --review-download-only
```

The generated installer points only to `http://127.0.0.1:38473`. Serve its payload in a separate terminal:

```powershell
node scripts/serve-web-preview.cjs
```

`--review-download-only` keeps this preview in download-review mode. It does not create a production release and it must not be presented as a public installer.

## Production-shaped build, without publishing

Use a GitHub repository name only after the release destination has been reviewed. Set it **before** creating the public stage so the staged application embeds the same update-feed location:

```powershell
$env:CALLME_RELEASE_REPOSITORY = 'IgorMonkey/LazyCall'
npm run pack:public
npm run dist:web -- --prepackaged release/public-review/win-unpacked --full-installer
```

The build validates this `owner/repository` value and writes the staged GitHub-provider update feed for that exact repository. Because this version is a prerelease, the app's semantic-version configuration resolves the matching `alpha.yml` feed after publication. Its underlying Electron-builder calls use `--publish never`: these commands build files locally and do not create a repository, upload assets, publish a release, or enable updates.

The online installer still needs real end-to-end validation on a suitable clean Windows machine before it can be offered publicly. Verify download, checksum failure, VC runtime download and installation, a missing-Codex path, an installed-Codex path, uninstall behaviour, and upgrade behaviour. Keep release notes and assets under maintainer review.

## Do not use old offline artifacts as public assets

`npm run dist:win` and the older development setup bundle app-local Microsoft VC DLLs and, in the offline path, Codex. They are useful for development and historical validation, but they are not approved public assets for this pipeline. Do not upload `runtime/`, old local installers, or any `release/` artifact without the release review described above.
