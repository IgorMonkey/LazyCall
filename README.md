<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/lazycall-lockup-light.svg">
  <img src="assets/lazycall-lockup.svg" width="280" alt="LazyCall">
</picture>

# LazyCall

[![CI](https://github.com/IgorMonkey/LazyCall/actions/workflows/ci.yml/badge.svg)](https://github.com/IgorMonkey/LazyCall/actions/workflows/ci.yml)

**You generated the code. Now explain it.**

Built with Codex. For projects built with Codex.

LazyCall helps you recover the context of an AI-built project during a technical call: it listens, checks the current files you chose, and drafts a reply you can verify.

[Русский](README.ru.md) · [Screenshots](docs/SCREENSHOTS.md) · [Contributing](CONTRIBUTING.md) · [Privacy](docs/PRIVACY.md) · [Roadmap](docs/ROADMAP.md)

> **Experimental alpha for Windows x64.** Expect bugs, delays, and suggestions that miss the point. Try it, report reproducible problems, and send PRs — contributions are welcome.

## What it does

- Transcribes microphone and system audio locally with Whisper on CPU or NVIDIA CUDA.
- Drafts short replies tied to a specific participant utterance, with a follow-up chat.
- Lets you optionally connect a repository folder, meeting goal, and documents.
- Keeps editable transcripts, notes, history, and evidence-linked outcomes.
- Includes a compact always-on-top window, shortcuts, and light and dark themes.

Recording and transcription do not need a project folder or an AI provider. AI replies can be wrong; check technical claims and decisions before using them. Response time depends on the model, the computer, and whether code needs to be read.

## A first call

1. Select a microphone and the call window. System audio can include other applications on the same output device.
2. Optionally connect a project folder from **Screen and files**. The assistant has bounded read-only access and does not modify code.
3. Start the meeting. Connect Codex in Settings when you want AI reply drafts.
4. Choose **Suggest an answer**, or type a question. LazyCall shows which utterance the reply addresses.
5. End the recording, review the outcomes, save or export them, then continue work in Codex if useful.

The **More** menu contains **Mini window**, **Export**, and **How it works**. `Ctrl+Alt+Space` shows or hides the compact window. `Ctrl+Alt+Enter` asks for a reply during recording. `Enter` sends a question and `Shift+Enter` inserts a line; this can be changed in Settings. Another application can reserve a system shortcut, and LazyCall shows that status.

## AI providers

**Codex is the only implemented provider.** LazyCall finds a native installed Codex CLI and lets you connect it through the interface. If it is not found, you can open the official setup guide or choose `codex.exe`. Its profile is isolated, so signing in may be required separately from other Codex clients.

Claude Code, direct OpenAI or Anthropic APIs, OpenRouter, other OpenAI-compatible services, and Ollama are planned adapter directions, not current features. See the [roadmap](docs/ROADMAP.md) for contribution context. Features such as images, web search, streaming, and repository tools must be checked per provider.

## Data and privacy

Transcription runs on the computer. Meetings, notes, selected-window frames, and settings stay in the legacy compatibility folder `%APPDATA%\CallMe`; its name is retained so existing data remains available. When an online assistant is used, LazyCall sends the needed excerpts of the meeting, materials, and code; with screen context enabled, it also sends a frame from the selected window. This is not fully offline AI. Read the [privacy notes and data flows](docs/PRIVACY.md) before using it with sensitive work.

Record calls only with the consent required for the participants and jurisdiction. Never put real recordings, transcript excerpts, screenshots, tokens, or private-source excerpts in a public issue.

## Build from source

Development requires **Windows x64**, **Node.js 24 LTS**, and npm.

```powershell
npm ci
npm run build
npm test
```

`npm run setup` downloads pinned development runtimes and a speech model. App packaging, the online installer, and validation are described in [the build guide](docs/BUILD.md).

## Status and limitations

This is an early open-source project still being tested on real calls. A suggestion can arrive late, misunderstand the question, or give a wrong answer. The interface and behaviour will change as testing continues. Before an important call, check audio capture and the assistant with a short test recording.

- Windows x64 is the supported target; macOS and Linux have not been verified.
- Remote participants are not yet identified by name, and there is no intermediate transcription.
- Cloud reply drafts require an available provider and use that provider's limits.
- A first lookup in an unfamiliar repository can be slower than a later one.
- The interface supports English and Russian, with light, dark, and system themes.
- Online-installer validation is not complete. The alpha update configuration exists locally, but no update feed has been published.

## Contributing

Bug fixes, UX improvements, translations, tests, and provider adapters are welcome. For a substantial change, open an issue first. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

Use GitHub Issues for ordinary bugs and ideas. Report security issues through [SECURITY.md](SECURITY.md), not a public issue. Review and response times depend on maintainer availability.

## Licenses

The original code is licensed under the [MIT License](LICENSE). Dependencies, fonts, models, and native components retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
