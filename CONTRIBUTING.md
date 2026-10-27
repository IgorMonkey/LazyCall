# Contributing to LazyCall

[Русский](CONTRIBUTING.ru.md)

Contributions are welcome: bug fixes, UX improvements, translations, tests, documentation, and AI-provider adapters. For a substantial feature, open an issue before implementation so the scope and user flow can be discussed. Small, focused fixes can be proposed directly as pull requests.

## Development

Use Windows x64, Node.js 24 LTS, Corepack, and Yarn 4.13.0.

```powershell
corepack enable
yarn --version
yarn install --immutable
yarn build
yarn test
```

These checks must not use a ChatGPT account, real meeting data, a microphone, model requests, or cloud services. `yarn setup` downloads native dependencies for development; read [the build guide](docs/BUILD.md) before packaging native binaries.

For branch, PR, compatibility, and version rules, read the [development workflow](docs/DEVELOPMENT_WORKFLOW.md).


Use exact dependency versions in `package.json`, without `^` or `~`. Yarn defaults to exact additions; commit `yarn.lock` with dependency changes. CI rejects version ranges and lockfile changes during installation.

## Pull requests

Explain the user problem, resulting behaviour, and verification. Use synthetic conversations and project names in screenshots. Run the commands above plus focused checks relevant to the change; do not claim checks you did not run.

AI assistance is welcome, but the contributor must understand and explain the submitted change. Keep unrelated refactors out of bug fixes. Preserve compatibility with saved meetings and settings. Never start a real microphone, send model requests, or create external chats in automated tests without explicit opt-in.

Never commit `runtime/`, `release/`, `test-results/`, authentication files, private meeting transcripts, API keys, or screenshots containing personal data. Check the staged file list before committing.

## Provider adapters

Codex is the only implemented provider. Claude Code, OpenAI and Anthropic APIs, OpenRouter and other OpenAI-compatible services, and Ollama are plans; see [the roadmap](docs/ROADMAP.md). New adapters need tests for streaming, cancellation, errors and timeouts, isolated credentials, project read access, and unsupported capabilities. Do not silently switch providers or reuse another application's tokens.

## Finding work

We use `good first issue` for small tasks and `help wanted` for areas where community help is needed. Feature suggestions, bug reports, and documentation improvements are useful too.

Contributions to original LazyCall code are submitted under the [MIT License](LICENSE). Third-party code must retain its applicable notices and licensing terms. Reviews and response times depend on maintainer availability.
