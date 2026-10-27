const { execFileSync } = require("node:child_process");
const { mkdirSync } = require("node:fs");
const path = require("node:path");
mkdirSync("test-results", { recursive: true });
const dest = path.resolve("test-results/speech-16k.wav");
execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
  "Add-Type -AssemblyName System.Speech; " +
  "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; " +
  "$s.SelectVoice('Microsoft Irina Desktop'); " +
  "$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono); " +
  "$s.SetOutputToWaveFile($env:CALLME_FIXTURE, $f); " +
  "$s.Speak('Здравствуйте. Давайте добавим поиск по номеру заявки. Это тест локального распознавания.'); $s.Dispose();"
], { windowsHide: true, env: { ...process.env, CALLME_FIXTURE: dest }, stdio: "inherit" });
console.log(dest);
