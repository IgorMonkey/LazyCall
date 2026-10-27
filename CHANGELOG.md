# LazyCall changelog

## Unreleased

- Electron 45 with Node 24 types aligned to its embedded runtime.
- Updated, commit-pinned GitHub Actions and a working clean-runner release-review build.
- CPU speech inference can take up to two minutes on slower hardware. CUDA keeps
  its 30-second limit; the bounded queue and 20-second stop-drain limit are unchanged.

## 0.3.6 — workspace and dialog alignment

- Shared grid for the transcript and assistant panes: aligned labels, text areas,
  divider and action rows at supported desktop sizes.
- Resizing the question field also resizes the notes row; long histories scroll
  independently without moving the input controls.
- Reconnection notices stay in the assistant history instead of shifting its form.
- Consistent content spacing in project, history, outcome and transcript dialogs;
  history titles and project actions stay visible while content scrolls.
- Refreshed Russian/English screenshots in both themes and responsive geometry checks.

The Windows builds remain unsigned. Clean-machine prerequisite installation and an
actual upgrade through the published GitHub feed still need end-to-end verification.

## 0.3.5 — first public release

- Optional discovery and selection of an installed Codex CLI.
- Russian/English UI and system language preference.
- LazyCall branding with a sleeping mascot and solid handwritten wordmark.
- Responsive header with bounded project/meeting names and a keyboard-accessible
  More menu for the mini window, export and tutorial.
- Separate online installer with a verified downloadable package.
- Public-release preparation: external Microsoft runtime prerequisite,
  explicit update controls, contributor guides and release checks.

This unsigned early release is for testing. The local installer flow covered install, corrupted-download retry, and uninstall. The GitHub update feed is not yet validated end to end.

## 0.3.4 — local preview

- Shared control spacing, icon geometry and bounded reply-target wrapping.
- Repacked full offline installer: 1,050,920,634 bytes, down 10.63% from the
  previous compression of the same files. Installed size is unchanged.

## 0.3.3 — local preview

- Activity-based assistant timeout with a bounded overall turn duration.
- Explicit spoken-reply contract and commentary separated from final answers.
- Anchored question blocks, retained user instructions and refreshed code context.
- Enter-to-send preference and clearer progress/context indicators.
