# LazyCall screenshot gallery

[Русский](SCREENSHOTS.ru.md)

A fictional order-search conversation. The language matches this page; each capture has a light and dark pair. No real meeting, repository, account, or provider material is shown.

The [layout guidelines](UI_GUIDELINES.md) describe the shared pane grid, dialog scrolling and the design references used for this interface.

## Selected synthetic English demo

These five captures describe one fictional order-search discussion. They switch between the paired light and dark captures with the reader’s theme preference.

### Main conversation

<picture><source media="(prefers-color-scheme: dark)" srcset="screenshots/readme-main-en-dark.png?v=a431c516c679"><img src="screenshots/readme-main-en-light.png?v=4c7c7bb2ef6d" alt="Synthetic English order-search transcript and access-check reply" width="960"></picture>

### Project context

<picture><source media="(prefers-color-scheme: dark)" srcset="screenshots/readme-context-en-dark.png?v=f4c374108300"><img src="screenshots/readme-context-en-light.png?v=a40ea47bcabe" alt="Synthetic English project folder and repository overview" width="960"></picture>

### Meeting outcomes

<picture><source media="(prefers-color-scheme: dark)" srcset="screenshots/readme-results-en-dark.png?v=77a4c0409080"><img src="screenshots/readme-results-en-light.png?v=a51a38e66491" alt="Synthetic English decision, task, and open question" width="960"></picture>

### Compact window

<picture><source media="(prefers-color-scheme: dark)" srcset="screenshots/readme-compact-en-dark.png?v=efad610ead7a"><img src="screenshots/readme-compact-en-light.png?v=f7eba49cb808" alt="Synthetic English compact reply" width="404"></picture>

### Onboarding

<picture><source media="(prefers-color-scheme: dark)" srcset="screenshots/readme-onboarding-en-dark.png?v=9302a5938f3d"><img src="screenshots/readme-onboarding-en-light.png?v=e19d9ec4e858" alt="English onboarding, step three" width="560"></picture>

<details>
<summary>Fixture coverage and regeneration</summary>

Run `node scripts/build-screenshot-gallery.cjs` to regenerate the complete local review gallery at `release/maintainer-review/full-gallery/index.html`; `index.json` beside it is the machine-readable manifest. It uses local Playwright fixtures only.

- Main flow: idle, live, paused, saved meeting, transcript correction, follow-to-latest behavior, and responsive header/More menu.
- Assistant: empty/disconnected, project-reading stream, answer, retryable error, installed/missing Codex, and update-channel states.
- Materials, projects, meetings/history, outcomes, all settings tabs, Russian and English, light and dark themes, all onboarding steps, and compact-window states.
</details>
