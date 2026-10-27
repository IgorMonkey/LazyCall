# LazyCall screenshot gallery

[Русский](SCREENSHOTS.ru.md)

The gallery is regenerated with `node scripts/build-screenshot-gallery.cjs`. It uses local Playwright fixtures only. It never uses a real meeting, recording, repository, account, provider response, audit, or replay screenshot.

The local review page is generated at `release/maintainer-review/full-gallery/index.html`; its machine-readable manifest is `index.json` beside it. This directory keeps a small curated selection; the complete local gallery stays out of the public repository.

## Coverage

- Main flow: idle, live, paused (fixture control coverage), saved meeting, transcript correction, follow-to-latest behavior, and responsive header/More menu.
- Assistant: empty/disconnected, project-reading stream, answer, retryable error, installed/missing Codex, and update-channel fixture states.
- Materials: no folder, project-analysis progress, connected overview, and a recoverable analysis error.
- Projects, meetings/history, outcomes: empty/generated/stale evidence and manual review controls.
- Settings: recording, assistant/Codex, data, appearance, and updates; Russian and English; light and dark themes.
- Onboarding: all three steps in Russian and English.
- Compact window: idle/live, project-reading stream, error, and minimum-width layout.

## Selected captures

| State | Capture |
| --- | --- |
| Live response target | ![Live response target](screenshots/assistant-live-target-v8.png) |
| Connected repository overview | ![Connected repository overview](screenshots/repository-connected-light.png) |
| Outcomes with evidence | ![Outcomes with evidence](screenshots/assistant-results-v7.png) |
| English dark onboarding | ![English dark onboarding](screenshots/review-onboarding-en-dark-step3-904.png) |
| Compact window | ![Compact window](screenshots/compact-live.png) |
| Narrow responsive header | ![Narrow responsive header](screenshots/header-ru-light-640.png) |
