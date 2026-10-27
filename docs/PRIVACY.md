# Data and privacy

[Русский](PRIVACY.ru.md)

LazyCall stores meetings and processes speech on the computer. That does not mean that an online assistant is offline or that all stored data is encrypted.

| Activity | Where data goes |
| --- | --- |
| Recording and transcription | Microphone and system audio are processed locally by Whisper; final utterances are stored locally. |
| Selected screen | Frames from the selected window are stored locally during a meeting. They can be sent to the assistant when screen context is enabled. |
| Project overview and AI question | Needed excerpts of the transcript, notes, documents, and files read from the selected repository are sent to the configured online provider. |
| Web search | Enabled for an individual request and governed by the provider's policy. |
| Export or handoff to Codex | A user action creates local files or copies data to the clipboard; sending afterwards is controlled by the target application. |
| MCP integration | Enabled separately; gives a client bounded read-only access to saved meetings and projects. |
| Installation and updates | Program files are downloaded from release and supplier sources; meeting text is not required for this. |

User data lives in the legacy compatibility folder `%APPDATA%\CallMe`, including meetings, notes, selected frames, and a separate assistant-authentication profile. The folder name is retained so existing data remains available after the rename; uninstalling the app keeps it. Do not publish it or attach it wholesale to a bug report. Meeting storage does not have built-in encryption; rely on device and Windows-account protection.

The assistant accesses a connected project folder through bounded read tools. Sensitive and generated names, binary files, and link escapes are excluded, but this cannot guarantee that an allowed text file has no confidential material. Connect only material you are allowed to send to the selected provider. These tools do not modify source code.

Each AI service has its own limits and policies for request processing and retention. LazyCall cannot promise that a service does not retain or train on data. Transcription, notes, and history remain available without an online assistant.

Use synthetic data in public screenshots and tests. Report suspected leaks through [SECURITY.md](../SECURITY.md).
