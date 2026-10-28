const { _electron: electron } = require("playwright");
const { mkdtemp, mkdir, readFile, readdir, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

(async () => {
  const data = await mkdtemp(path.join(tmpdir(), "callme-ui-"));
  await mkdir("test-results", { recursive: true });
  const env = { ...process.env, CALLME_TEST_DATA: data };
  delete env.ELECTRON_RUN_AS_NODE;
  const instance = await electron.launch({
    executablePath: require("electron"),
    args: [process.cwd(), "--use-fake-device-for-media-stream",
      "--use-file-for-fake-audio-capture=" + path.resolve("test-results/speech-16k.wav")],
    env, timeout: 30000
  });
  const errors = [];
  try {
    const page = await instance.firstWindow();
    await require("./prepare-ui-fixture.cjs")(page);
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    await page.getByRole("heading", { name: "LazyCall", exact: true }).waitFor();
    await page.locator('[data-testid="stt-status"][data-state="ready"]').waitFor({ timeout: 150000 });
    await page.evaluate(() => document.fonts.ready);
    const layout = async label => {
      const dimensions = await page.evaluate(() => {
        const root = document.documentElement;
        const app = document.querySelector(".app");
        const composer = document.querySelector(".assistant-composer textarea");
        return {
          width: innerWidth, height: innerHeight,
          overflowX: root.scrollWidth > innerWidth + 1, overflowY: root.scrollHeight > innerHeight + 1,
          composerVisible: composer.getBoundingClientRect().height >= 48,
          bodyFont: getComputedStyle(app).fontFamily,
          fontsLoaded: Array.from(document.fonts).filter(f => f.family.includes("Scada") && f.status === "loaded").length
        };
      });
      assert(!dimensions.overflowX && !dimensions.overflowY, label + " document overflow");
      assert(dimensions.composerVisible, label + " assistant input collapsed");
      assert(dimensions.fontsLoaded > 0, "Scada font not loaded");
      await page.screenshot({ path: "test-results/" + label + ".png" });
      return dimensions;
    };
    const desktop = await layout("callme-idle");
    assert(await page.getByRole("button", { name: "Начать встречу", exact: true }).isDisabled(), "Start must require an explicit source");
    const materials = page.getByRole("dialog", { name: "Материалы встречи", exact: true });
    await page.getByRole("textbox", { name: "Заметки", exact: true }).fill("Обсудить поиск по номеру заявки.");
    await page.evaluate(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.__microphoneSelectionChecks = [];
      navigator.mediaDevices.getUserMedia = async constraints => {
        const stream = await original(constraints);
        const requested = constraints.audio?.deviceId?.exact;
        if (requested) window.__microphoneSelectionChecks.push({ requested, actual: stream.getAudioTracks()[0].getSettings().deviceId });
        return stream;
      };
    });
    await page.getByRole('combobox', { name: 'Микрофон', exact: true }).click();
    await page.getByRole('option').filter({ hasText: /Fake/ }).first().waitFor();
    await page.getByRole('option').filter({ hasText: /Fake/ }).last().click();
    await instance.evaluate(async ({ BrowserWindow }) => {
      const target = new BrowserWindow({ width: 620, height: 430, show: true, title: "LazyCall — тест демонстрации", webPreferences: { nodeIntegration: false, sandbox: true } });
      await target.loadURL("data:text/html;charset=utf-8," + encodeURIComponent('<title>LazyCall — тест демонстрации</title><body style="margin:0;background:#202328;color:#eee;font:24px Segoe UI;padding:40px"><h1 style="font-size:30px">Тест демонстрации</h1><p>Заявка № 1042</p><p style="color:#c8ae96">Синтетический экран для проверки захвата</p></body>'));
      BrowserWindow.getAllWindows().find(w => w.getTitle() === "LazyCall").focus();
    });
    await page.getByRole("button", { name: "Обновить список окон и устройств" }).click();
    const meetingWindow = page.getByRole("combobox", { name: "Окно созвона" });
    await meetingWindow.click();
    await page.getByRole("option", { name: "LazyCall — тест демонстрации", exact: true }).click();
    await instance.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find(w => w.getTitle() === "LazyCall");
      main.setSize(920, 680);
    });
    await page.waitForTimeout(150);
    const minimum = await layout("callme-small");
    const noteBox = await page.getByRole("textbox", { name: "Заметки", exact: true }).boundingBox();
    assert(noteBox && noteBox.height >= 60, "Minimum-size material notes collapsed");
    await page.getByRole("button", { name: "Экран и файлы", exact: true }).click();
    await page.screenshot({ path: "test-results/callme-materials-small.png" });
    await materials.getByRole("button", { name: "Готово", exact: true }).click();
    await instance.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find(w => w.getTitle() === "LazyCall");
      main.setSize(1280, 880); main.focus();
    });
    await page.getByRole("button", { name: "Начать встречу", exact: true }).click();
    await page.getByText("Идёт встреча", { exact: true }).waitFor({ timeout: 15000 });
    const chosenMicrophone = await page.evaluate(() => window.__microphoneSelectionChecks);
    assert(chosenMicrophone.length === 1 && chosenMicrophone[0].actual === chosenMicrophone[0].requested, 'Recording must use the explicitly chosen microphone');
    assert(await page.getByRole("combobox", { name: "Микрофон", exact: true }).isDisabled(), "Live meeting must disable custom selects");
    assert(await page.getByRole("combobox", { name: "Окно созвона", exact: true }).isDisabled(), "Live meeting must disable custom selects");
    await page.screenshot({ path: "test-results/callme-live.png" });
    await page.getByRole("button", { name: "Экран и файлы", exact: true }).click();
    await materials.locator(".preview img").waitFor();
    await page.screenshot({ path: "test-results/callme-materials-live.png" });
    await materials.getByRole("button", { name: "Готово", exact: true }).click();
    // Let the actual AudioWorklet flush one synthetic phrase into the native model.
    await page.locator(".utterance.self p").filter({ hasText: "заявки" }).first().waitFor({ timeout: 90000 });
    await page.getByRole("button", { name: "Завершить", exact: true }).click();
    await page.getByText("Встреча сохранена", { exact: true }).waitFor({ timeout: 25000 });
    const saved = page.getByLabel("Завершённая запись", { exact: true });
    await saved.waitFor({ timeout: 25000 });
    assert.equal(await page.getByRole("combobox", { name: "Микрофон", exact: true }).count(), 0, "Saved view must hide microphone selection");
    assert.equal(await page.getByRole("combobox", { name: "Окно созвона", exact: true }).count(), 0, "Saved view must hide window selection");
    await saved.getByRole("button", { name: "Итоги встречи", exact: true }).waitFor();
    await saved.getByRole("button", { name: "Продолжить в Codex", exact: true }).waitFor();
    await saved.getByRole("button", { name: "Новая встреча", exact: true }).waitFor();
    const text = await page.locator(".utterance p").allTextContents();
    await page.screenshot({ path: "test-results/callme-transcript.png" });
    console.log(JSON.stringify({ observedTranscription: text }));
    assert(text.join(" ").includes("заявки"), "Synthetic Russian speech was not transcribed");
    assert.equal(await page.getByRole("textbox", { name: "Заметки", exact: true }).inputValue(), "Обсудить поиск по номеру заявки.");
    const transcript = await layout("callme-transcript");
    const sessions = await readdir(path.join(data, "sessions"));
    const events = (await readFile(path.join(data, "sessions", sessions[0], "events.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    assert(events.some(e => e.type === "frame.selected"), "Automatic frames were not saved");
    assert(events.some(e => e.type === "note.edited" && e.payload.text.includes("Обсудить")), "Prepared note was lost");
    assert(events.some(e => e.type === "session.stopped"));
    assert.deepEqual(errors, [], "Renderer errors");
    const result = { status: "passed", desktop, minimum, transcript, recognized: text, eventTypes: [...new Set(events.map(e => e.type))], errors };
    await writeFile("test-results/ui-check.json", JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally {
    await instance.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) if (window.getTitle() === "LazyCall — тест демонстрации") window.destroy();
    }).catch(() => {});
    await instance.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
