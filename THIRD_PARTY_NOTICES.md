# Third-party components

The MIT license at the root covers original LazyCall code. It does not relicense
third-party components, fonts, models, provider clients or their services.

| Component | License / terms | Delivery |
| --- | --- | --- |
| React, React DOM, scheduler | MIT | Included with the app; license texts retained by packaging |
| electron-updater | MIT | Included with its dependency license texts |
| Electron | MIT plus Chromium third-party notices | `LICENSE.electron.txt`, `LICENSES.chromium.html` in the application directory |
| Scada font | SIL Open Font License 1.1 | `licenses/Scada-OFL.txt` |
| whisper.cpp | MIT | Runtime license bundled with the speech engine |
| Whisper model | MIT, OpenAI | Model license bundled with speech resources |
| NVIDIA cuBLAS/CUDA runtime | NVIDIA CUDA EULA and redistribution conditions | Native GPU components retain vendor terms; not covered by LazyCall MIT |
| Codex CLI | Apache-2.0 plus upstream NOTICE | Public light build uses the user's separately installed client |
| Microsoft Visual C++ runtime | Microsoft license terms | Public light build must obtain the official installer directly from Microsoft; Microsoft DLLs are excluded from our downloadable payload |
| NSIS and installer plugins | Their upstream licenses | Used by electron-builder to produce the installer; not relicensed as LazyCall code |

The installer uses unmodified StdUtils 1.1.4.0 (LGPL-2.1-or-later with the
author's NSIS clarification) and INetC 1.0.5.6. Copies of their license texts are
in `licenses/`. StdUtils source and its clarification are available from
[lordmulder/stdutils](https://github.com/lordmulder/stdutils); the INetC fork
source is available at
[DigitalMediaServer/NSIS-INetC-plugin v1.0.5.6](https://github.com/DigitalMediaServer/NSIS-INetC-plugin/tree/v1.0.5.6).
NSIS itself and its compression modules retain the licenses described in the
[NSIS manual](https://nsis.sourceforge.io/Docs/AppendixI.html).

Development scripts may stage dependencies under ignored `runtime/`. That
directory and earlier local offline installers are not approved public release
assets. In particular, a copied Microsoft runtime license does not by itself
grant redistribution rights.

Provider accounts and API access are subject to their providers' service terms.
Installing a CLI does not grant model access or unlimited usage.

References: [Electron](https://github.com/electron/electron/blob/main/LICENSE),
[whisper.cpp](https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE),
[Codex license](https://github.com/openai/codex/blob/rust-v0.145.0/LICENSE),
[Codex NOTICE](https://github.com/openai/codex/blob/rust-v0.145.0/NOTICE),
[CUDA 11.8 EULA](https://docs.nvidia.com/cuda/archive/11.8.0/eula/index.html),
[Microsoft redistribution guidance](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files).
