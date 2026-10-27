# Building LazyCall

[Русский](BUILD.ru.md)

This guide describes the current Windows x64 public-review pipeline for version `0.3.6`. It creates review artifacts only; it does not publish a GitHub Release or make an update available to users.

## Development checks

Use Windows x64, Node.js 24 LTS, Corepack, and Yarn 4.13.0. The repository pins that exact Yarn version through `packageManager`; `yarn --version` confirms the Corepack-selected release. `nodeLinker: node-modules` is intentional for Electron tooling.

```powershell
corepack enable
yarn --version
yarn install --immutable
yarn build
yarn test
```

These checks do not need a ChatGPT login, real meeting data, a microphone, or a cloud-model call.

## Public-review stage

Create the fresh light staging folder with:

```powershell
yarn pack:public
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
yarn dist:web --prepackaged release/public-review/win-unpacked --local-preview --review-download-only
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
yarn pack:public
yarn dist:web --prepackaged release/public-review/win-unpacked --full-installer
```

The build validates this `owner/repository` value and writes the staged GitHub-provider update feed for that exact repository. A normal release uses the matching `latest.yml` feed; a future prerelease channel is a deliberate separate release decision. Its underlying Electron-builder calls use `--publish never`: these commands build files locally and do not create a repository, upload assets, publish a release, or enable updates.

The isolated local installer flow has covered installation, corrupted-download retry, and uninstall. A clean Windows machine without the Microsoft VC runtime and a real GitHub-hosted upgrade path are still unverified. Disclose those limits for this early release and keep release notes and assets under maintainer review.

## Do not use old offline artifacts as public assets

`yarn dist:win` and the older development setup bundle app-local Microsoft VC DLLs and, in the offline path, Codex. They are useful for development and historical validation, but they are not approved public assets for this pipeline. Do not upload `runtime/`, old local installers, or any `release/` artifact without the release review described above.
