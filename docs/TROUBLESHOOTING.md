# Windows troubleshooting

This guide covers common first-run problems in LazyCall. The exact wording may vary by Windows version and device. LazyCall is an experimental Windows x64 application; these steps do not guarantee every device or meeting app will work.

## Before a call

1. Open LazyCall and make a short test recording before an important meeting.
2. Confirm the intended microphone and call window are selected.
3. If you want AI reply drafts, check the Codex connection separately. Recording and local transcription can work without an AI provider.
4. Keep LazyCall and Windows up to date, and use the project's supported Windows x64 release.

## Microphone is missing, blocked, or busy

If LazyCall reports that microphone access is denied, no microphone was found, or the microphone is busy:

1. In Windows **Settings → Privacy & security → Microphone**, check that microphone access and access for desktop apps are allowed.
2. Connect the microphone, then check **Settings → System → Sound → Input** to see whether Windows detects it and whether the input meter responds.
3. In LazyCall, refresh the device list if that option is available, then select the intended microphone again.
4. Close other apps that may be exclusively using the microphone, such as another meeting or recording app, and retry.
5. If the selected device was unplugged or changed, choose the current device and restart the test recording.

LazyCall's capture code distinguishes permission, missing-device, unavailable-device, and busy-device errors. If the message persists after these checks, note the exact message and your Windows version.

## System audio is missing

System audio is captured separately from the microphone using **Windows loopback** from an audio output device. This can include sound from other applications playing through that same output device; it is not isolated to the selected call window. The **Meeting window** selector in LazyCall controls which window is shown/captured visually, not which application's audio is included.

1. Before recording, open Windows **Settings → System → Sound → Output** and check the default playback device. Make sure the meeting audio is playing through that device.
2. Check Windows volume and **Volume mixer** / per-app output routing. If the meeting app is routed to a different headset or output device, loopback capture from the default device may not include it.
3. In LazyCall, select the intended **Meeting window** before starting the meeting/recording. This selects the visual source; it does not filter loopback audio to that window.
4. If LazyCall says **“System audio was not received; only the microphone is being transcribed”**, check the playback device and per-app routing, then make a short test again. Continue with microphone-only capture only if that is sufficient.

Make a short test and verify the transcript before relying on it. Audio from other applications using the captured output device may also be included.

## The call window or screen cannot be captured

If Windows denies capture, the source is missing, or another application is using it:

1. In LazyCall, use the **Meeting window** selector to choose the currently open call window before starting the meeting/recording. This is an in-app selector, not a Windows sharing prompt.
2. If the window was closed, renamed, or recreated, reopen the meeting and select the new window.
3. Close other screen-recording or capture tools if they may be holding the source, then retry.
4. If permission was denied, start again and allow the capture prompt. Do not disable Windows security protections to work around a capture failure.

Some source types or applications may not be capturable in every environment. If the same source fails repeatedly, report the source type and the exact error without sharing private meeting content.

## Local transcription, Whisper, CPU, and CUDA

Whisper performs transcription locally. It needs the installed model and runtime components; the first setup can require downloading those components.

- **“Model not found”**: run the supported installation/setup flow again or retry the component download. Confirm the installation completed and that available disk space is sufficient.
- **CUDA startup fails**: when compute is set to automatic and a CUDA runtime is available, LazyCall tries CUDA and can fall back to CPU if CUDA startup fails. You can choose **CPU only** in recognition settings to avoid GPU initialization.
- **CPU transcription is slower**: CPU mode can work without CUDA, but performance depends on your processor and the selected model. Keep a short test running and check whether the transcription queue is falling behind.
- **Whisper does not start**: record the exact status/error message, whether CPU-only mode works, and whether setup finished. Do not download replacement executables or models from unofficial sources.

If a component download fails, retry on a stable network. Do not publish installer logs containing personal paths or other private information without reviewing and redacting them first.

## Codex CLI is not found

Codex is the currently implemented AI provider. Other providers mentioned in the roadmap are not available features yet.

1. Install the official Codex CLI using its official instructions.
2. In LazyCall's assistant settings, try connecting again.
3. If automatic discovery fails, use the interface's option to choose `codex.exe`, if available, and select the native executable rather than a shell script or command shim.
4. If the executable is installed in a custom location, make sure you select the correct file and retry the connection.

LazyCall checks known executable locations; it does not recursively search every drive. Having another Codex client installed does not necessarily mean LazyCall's isolated profile is already signed in.

## Codex sign-in or connection fails

1. Open assistant settings and choose the connect/sign-in action.
2. Complete the sign-in flow in the window or browser that opens, then return to LazyCall and check the connection status.
3. If you recently changed accounts, confirm the intended account is active in LazyCall's own profile.
4. Retry on a stable network. If the problem persists, note the displayed error and whether the CLI works outside LazyCall.

Do not post access tokens, authentication codes, browser cookies, credential files, or screenshots that expose account details in a public issue. Never send these to a contributor or maintainer.

## The first reply is slow or no reply appears

A first reply can take longer than later replies, especially when LazyCall needs to inspect an unfamiliar repository. Reply generation requires a working Codex connection and network access; local recording/transcription does not.

1. Confirm the Codex connection is ready and that the computer has network access.
2. Check that the transcript contains the question or utterance you want to answer.
3. If a project folder is connected, allow time for the first repository lookup to finish. A later lookup may be faster.
4. Try a short, specific question. Check the displayed status/error before repeatedly submitting the same request.
5. If the issue continues, test without an optional project folder to help determine whether the delay is related to repository context.

AI-generated replies can be incorrect or incomplete. Verify technical claims before using them in a call or making decisions.

## What to include in a bug report

Please include only what is necessary to reproduce the issue:

- LazyCall version and Windows version.
- The steps you took and what you expected versus what happened.
- The exact error/status text, copied as plain text where possible.
- Whether the issue affects microphone, system audio, window capture, local transcription, or Codex replies.
- For transcription performance, whether CPU-only mode changes the result.

Use synthetic examples. Do **not** attach real recordings, transcript excerpts, private source code, API keys, access tokens, authentication codes, cookies, or full unredacted logs. Review screenshots carefully for names, meeting details, notifications, and personal paths.

## Local versus online features

- **Local:** microphone/system-audio capture and Whisper transcription run on your computer once the required components are installed.
- **Requires Codex and network access:** AI reply drafts and follow-up assistant requests.
- **Optional project context:** when you connect a project folder or enable screen context, relevant excerpts or a frame may be sent to the online assistant to produce a reply. Read the [privacy notes](PRIVACY.md) before using sensitive material.

For general setup and development requirements, see the [README](../README.md) and [build guide](BUILD.md).
