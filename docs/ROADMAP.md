# Roadmap

[Русский](ROADMAP.ru.md)

This is intent, not a list of available features or release dates.

## Current focus

- A reliable technical-call flow: reply attached to a question, current code reading, a ready-to-say draft, and honest messages when information is missing.
- Faster first useful replies and resilience in long meetings.
- Clear installation, Codex connection, localisation, and reviewable releases.

## Assistant adapters

| Direction | Status | What must be checked |
| --- | --- | --- |
| Codex app-server | Implemented | CLI version, event stream, cancellation, model access, and project reading. |
| Installed Codex CLI | Implemented | Discovery, native executable choice, and an isolated LazyCall profile. |
| Claude Code | Planned | Official programmatic interface, terms, tools, and cancellation. |
| OpenAI API | Planned | User API key, separate billing, models, and supported capabilities. |
| Anthropic API | Planned | User API key, streaming, images, and tool calls. |
| OpenRouter / OpenAI-compatible | Planned | Base URL, models, capabilities, protocol differences; compatibility is never assumed. |
| Ollama / local models | Planned | Device performance, context length, tools, and images. |

Every adapter must describe text, images, streaming, search, tools, cancellation, and model choice explicitly. The UI must not advertise unsupported capabilities. Meeting context and safe project reading remain shared LazyCall components; authentication and protocol belong to the adapter.

Keys must not be stored in source code, URLs, or plain ordinary settings. API adapters need an approved Windows secure-storage design, key removal, and tests that secrets do not reach logs. They must not take tokens from another application without a supported mechanism and user action.

## Later

- Remote-speaker separation.
- Smaller application updates that do not re-download an unchanged speech model.
- More operating systems after capture and packaging are verified.
- A wider set of measured scenarios and latency evidence.

Proposals and adapters are welcome. Discuss substantial changes and acceptance checks in an issue first; see [CONTRIBUTING.md](../CONTRIBUTING.md).
