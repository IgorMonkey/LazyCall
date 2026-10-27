const { _electron: electron } = require("playwright");
const { mkdtemp, mkdir, readFile, readdir, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const until = async (check, message, timeout = 30000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 75)); }
  throw new Error(message);
};

(async () => {
  const data = await mkdtemp(path.join(tmpdir(), "callme-recording-controls-"));
  const packaged = process.env.CALLME_PACKAGED_EXE;
  const env = packaged ? { ...process.env } : { ...process.env, CALLME_TEST_DATA: data };
  delete env.ELECTRON_RUN_AS_NODE;
  await mkdir("test-results", { recursive: true });
  const instance = await electron.launch({
    executablePath: packaged || require("electron"),
    args: [...(packaged ? ["--user-data-dir=" + data] : [process.cwd()]), "--use-fake-device-for-media-stream", "--use-file-for-fake-audio-capture=" + path.resolve("test-results/speech-16k.wav")], env, timeout: 30000
  });
  try {
    const page = await instance.firstWindow();
    await page.getByRole("heading", { name: "LazyCall", exact: true }).waitFor();
    await page.locator('[data-testid="stt-status"][data-state="ready"]').waitFor({ timeout: 150000 });
    await page.evaluate(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      const originalDisplay = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        const stream = await original(constraints);
        window.__captureTestMic = stream.getAudioTracks()[0];
        return stream;
      };
      navigator.mediaDevices.getDisplayMedia = async constraints => {
        const display = await originalDisplay({ ...constraints, audio: false });
        for (const track of display.getAudioTracks()) {
          display.removeTrack(track);
          track.stop();
        }
        const syntheticAudio = await original({ audio: true, video: false });
        display.addTrack(syntheticAudio.getAudioTracks()[0]);
        return display;
      };
    });
    await instance.evaluate(async ({ BrowserWindow, ipcMain }) => {
      global.__captureCounts = { audio: 0, frame: 0 };
      ipcMain.on("capture:audio", () => { global.__captureCounts.audio++; });
      ipcMain.on("capture:frame", () => { global.__captureCounts.frame++; });
      const target = new BrowserWindow({ width: 640, height: 420, show: true, title: "LazyCall — pause fixture", webPreferences: { sandbox: true } });
      await target.loadURL("data:text/html;charset=utf-8," + encodeURIComponent('<body style="margin:0"><div id="v" style="height:100vh;background:#202328;color:white;font:32px sans-serif;padding:40px">Synthetic capture</div><script>let n=0;setInterval(()=>{n++;document.body.style.background=`hsl(${n*37%360} 50% 30%)`;document.querySelector("#v").textContent="Synthetic capture "+n},250)</script>'));
      BrowserWindow.getAllWindows().find(window => window.getTitle() === "LazyCall").focus();
    });
    const initialSettings = await page.evaluate(() => window.callme.settings());
    assert(!path.relative(data, initialSettings.dataDirectory).startsWith(".."), "Test session data must stay under its isolated user-data directory");
    await page.getByRole("button", { name: "Обновить список окон и устройств" }).click();
    await page.getByRole("combobox", { name: "Окно созвона", exact: true }).click();
    await page.getByRole("option", { name: "LazyCall — pause fixture", exact: true }).click();
    await page.getByRole("button", { name: "Начать встречу", exact: true }).click();
    await page.getByText("Идёт встреча", { exact: true }).waitFor({ timeout: 20000 });
    await until(async () => (await instance.evaluate(() => global.__captureCounts)).frame > 0, "Initial frame was not delivered");
    await until(async () => (await instance.evaluate(() => global.__captureCounts)).audio > 0, "Initial synthetic PCM was not delivered", 90000);
    const beforePause = await instance.evaluate(() => ({ ...global.__captureCounts }));
    await page.getByRole("button", { name: "Пауза", exact: true }).click();
    await page.getByText("Запись на паузе", { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText("Звук и кадры не поступают", { exact: true }).waitFor();
    await page.evaluate(() => window.__captureTestMic.dispatchEvent(new Event("mute")));
    await page.evaluate(() => window.__captureTestMic.dispatchEvent(new Event("unmute")));
    // A final pre-pause phrase is allowed to flush before the renderer pause resolves.
    await page.waitForTimeout(500);
    const settledPaused = await instance.evaluate(() => ({ ...global.__captureCounts }));
    await until(async () => !(await page.evaluate(() => window.callme.whisperStatus())).pending, "Pre-pause queue did not drain");
    const sessionsDirectory = initialSettings.dataDirectory;
    const session = (await readdir(sessionsDirectory))[0];
    const eventsFile = path.join(sessionsDirectory, session, "events.jsonl");
    const countEvents = async () => {
      const events = (await readFile(eventsFile, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
      return { transcript: events.filter(event => event.type === "transcript.final").length, frame: events.filter(event => event.type === "frame.selected").length };
    };
    const nativePausedBefore = await countEvents();
    await page.evaluate(() => {
      window.callme.audio("self", 20000, 20100, new Int16Array(1600).buffer);
      window.callme.frame("data:image/jpeg;base64,AA==", 20000);
    });
    await page.waitForTimeout(500);
    assert.deepEqual(await countEvents(), nativePausedBefore, "Native pause gate must reject direct audio/frame IPC injection");
    const afterInjection = await instance.evaluate(() => ({ ...global.__captureCounts }));
    await page.screenshot({ path: "test-results/recording-controls-paused.png" });
    await page.waitForTimeout(2600);
    const paused = await instance.evaluate(() => ({ ...global.__captureCounts }));
    assert.deepEqual(paused, afterInjection, "Paused renderer must not emit new PCM or frames after its pre-pause flush");
    await page.getByRole("button", { name: "Продолжить", exact: true }).click();
    await page.getByText("Идёт встреча", { exact: true }).waitFor({ timeout: 15000 });
    await until(async () => (await instance.evaluate(() => global.__captureCounts)).frame > paused.frame, "Frames did not resume");
    await until(async () => (await instance.evaluate(() => global.__captureCounts)).audio > paused.audio, "Synthetic PCM did not resume", 45000);
    await page.getByRole("button", { name: "Пауза", exact: true }).click();
    await page.getByText("Запись на паузе", { exact: true }).waitFor({ timeout: 15000 });
    const secondPause = await instance.evaluate(() => ({ ...global.__captureCounts }));
    await page.getByRole("button", { name: "Завершить", exact: true }).click();
    await page.getByText("Встреча завершена", { exact: true }).waitFor({ timeout: 25000 });
    assert.deepEqual(await instance.evaluate(() => ({ ...global.__captureCounts })), secondPause, "Stopping a paused capture must not reopen audio or frames");
    const events = (await readFile(eventsFile, "utf8")).trim().split("\n").map(JSON.parse);
    const types = events.map(event => event.type);
    assert(types.includes("capture.paused") && types.includes("capture.resumed"), "Native journal must acknowledge pause and resume");
    assert(types.includes("session.stopped"), "Stop while paused must close the same session");
    const pause = events.find(event => event.type === "capture.paused");
    const resume = events.find(event => event.type === "capture.resumed");
    assert(Date.parse(resume.payload.atUtc) >= Date.parse(pause.payload.atUtc), "Pause/resume journal time must be monotonic");
    const health = events.filter(event => event.type === "health").map(event => event.payload.message).join(" ");
    assert(health.includes("Микрофон временно отключён") && health.includes("Микрофон снова передаёт звук"), "Track mute/unmute must surface useful health messages");
    const report = { status: "passed", packaged: !!packaged, counts: { beforePause, settledPaused, afterInjection, paused, resumed: await instance.evaluate(() => ({ ...global.__captureCounts })) }, checks: ["renderer PCM/frame gate", "native direct-IPC pause gate", "native pause journal", "same-session resume timeline", "stop while paused", "track mute/unmute health"], fixture: "isolated Electron fake microphone and owned dynamic capture window" };
    await writeFile("test-results/recording-controls.json", JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  } finally {
    await instance.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) if (window.getTitle() === "LazyCall — pause fixture") window.destroy(); }).catch(() => {});
    await instance.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
