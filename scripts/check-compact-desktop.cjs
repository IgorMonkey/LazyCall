const { _electron: electron } = require("playwright");
const { mkdtemp, mkdir, readFile, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await sleep(75); }
  throw new Error("Timed out: " + label);
}

async function launch(data, conflict) {
  const env = { ...process.env, CALLME_TEST_DATA: data, CALLME_SKIP_WHISPER: "1" };
  if (conflict) env.CALLME_FIXTURE_SHORTCUT_CONFLICT = conflict;
  delete env.ELECTRON_RUN_AS_NODE;
  const instance = await electron.launch({ executablePath: require("electron"), args: [path.join(__dirname, "fixtures/compact-main.cjs")], env, timeout: 30000 });
  const main = await instance.firstWindow();
  await main.getByRole("heading", { name: "LazyCall", exact: true }).waitFor();
  await main.waitForFunction(async () => (await window.callme.agentStatus()).state === "ready");
  const runtime = await instance.evaluate(({ app }) => ({ data: app.getPath("userData"), packaged: app.isPackaged }));
  assert.equal(runtime.data, data); assert.equal(runtime.packaged, false);
  return { instance, main };
}

async function compactPage(instance) {
  await until(() => instance.windows().length === 2, "compact window creation");
  const main = await instance.firstWindow();
  return (await instance.windows()).find(page => page !== main);
}

(async () => {
  const data = await mkdtemp(path.join(tmpdir(), "callme-compact-desktop-"));
  await mkdir("test-results", { recursive: true });
  let instance;
  try {
    ({ instance } = await launch(data));
    const main = await instance.firstWindow();
    await main.evaluate(() => window.callme.showCompact());
    const compact = await compactPage(instance);
    assert(compact, "Compact window was not found");
    const native = await instance.evaluate(({ BrowserWindow, nativeTheme }) => {
      const window = BrowserWindow.getAllWindows().find(item => item.getTitle() === "LazyCall — подсказки");
      const prefs = window?.webContents.getLastWebPreferences?.();
      return window && { visible: window.isVisible(), alwaysOnTop: window.isAlwaysOnTop(), minimizable: window.isMinimizable(), maximizable: window.isMaximizable(), bounds: window.getBounds(), background: window.getBackgroundColor(), dark: nativeTheme.shouldUseDarkColors, prefs };
    });
    assert(native?.visible && native.alwaysOnTop, "Compact window must be visible and always-on-top");
    assert(native.bounds.width >= 360 && native.bounds.width <= 720 && native.bounds.height >= 380, "Compact bounds must be constrained");
    assert.equal(native.minimizable, false); assert.equal(native.maximizable, false);
    assert.equal(native.prefs?.sandbox, true); assert.equal(native.prefs?.contextIsolation, true); assert.equal(native.prefs?.nodeIntegration, false);
    assert.equal(await compact.evaluate(() => typeof window.callme), "undefined", "Compact renderer must not expose the full desktop bridge");
    assert.deepEqual(await compact.evaluate(() => Object.keys(window.callmeCompact).sort()), ["ask", "cancel", "copyAnswer", "hide", "onSnapshot", "openLink", "showMain", "snapshot"], "Compact preload must expose only its minimal API");
    await compact.evaluate(() => { window.__compactSnapshots = []; window.callmeCompact.onSnapshot(value => window.__compactSnapshots.push(value)); });
    const idleError = await compact.evaluate(() => window.callmeCompact.ask().then(() => "", error => String(error)));
    assert.match(idleError, /Сначала начните запись/, "Compact ask must reject while idle");
    const untrustedRejected = await instance.evaluate(async ({ BrowserWindow }, preload) => {
      const auxiliary = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } });
      try { await auxiliary.loadURL("about:blank"); return await auxiliary.webContents.executeJavaScript("window.callmeCompact.snapshot().then(() => false, () => true)"); }
      finally { auxiliary.destroy(); }
    }, path.resolve("dist-electron/compact-preload.js"));
    assert.equal(untrustedRejected, true, "Compact IPC must reject a minimal bridge from an untrusted frame");

    await main.evaluate(async () => { await window.callme.selectWindow("window:fixture:compact"); await window.callme.start(); window.callme.audio("remote", 0, 800, new Uint8Array(320).buffer); });
    await main.locator(".utterance").waitFor();
    await until(() => compact.evaluate(() => window.callmeCompact.snapshot()).then(value => !!value.target), "initial compact target");
    await main.evaluate(() => window.callme.setCapturePaused(true));
    const pausedError = await compact.evaluate(() => window.callmeCompact.ask().then(() => "", error => String(error)));
    assert.match(pausedError, /паузе/, "Compact ask must reject while capture is paused");
    await main.evaluate(() => window.callme.setCapturePaused(false));

    await instance.evaluate(() => global.__compactShortcutHandlers.get("Control+Alt+Enter")());
    await until(() => compact.evaluate(() => window.callmeCompact.snapshot()).then(value => value.busy), "shortcut reply start");
    const busyError = await compact.evaluate(() => window.callmeCompact.ask().then(() => "", error => String(error)));
    assert.match(busyError, /Дождитесь ответа|завершения/, "Compact ask must reject while another reply is active");
    await main.evaluate(() => window.callme.audio("remote", 900, 1500, new Uint8Array(320).buffer));
    await until(() => compact.evaluate(() => window.callmeCompact.snapshot()).then(value => value.target?.text.includes("NEWER")), "newer remote target snapshot");
    await until(() => compact.evaluate(() => window.callmeCompact.snapshot()).then(value => value.answer?.state === "done"), "compact streamed answer");
    const completed = await compact.evaluate(() => window.callmeCompact.snapshot());
    assert(completed.target?.text.includes("NEWER"), "Latest target must follow later transcript");
    assert(completed.answerTarget?.text.includes("COMPACT_TARGET"), "Answer target must stay anchored to the request-time transcript line");
    assert((await compact.evaluate(() => window.__compactSnapshots.length)) > 0, "Compact snapshot listener must receive main-process updates");

    await instance.evaluate(() => global.__compactShortcutHandlers.get("Control+Alt+Space")());
    await until(() => instance.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows().some(window => window.getTitle() === "LazyCall — подсказки" && window.isVisible())), "compact hide shortcut");
    assert.equal((await compact.evaluate(() => window.callmeCompact.snapshot())).phase, "live", "Hiding compact must not stop the meeting");
    await instance.evaluate(() => global.__compactShortcutHandlers.get("Control+Alt+Space")());
    await until(() => instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.getTitle() === "LazyCall — подсказки" && window.isVisible())), "compact show shortcut");

    const closePromise = compact.waitForEvent("close");
    await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === "LazyCall")?.close());
    await closePromise;
    await until(async () => (await readFile(path.join(data, "compact-shortcuts.json"), "utf8")).includes("Control+Alt+Enter"), "shortcut disposal log");
    const shortcutLog = JSON.parse(await readFile(path.join(data, "compact-shortcuts.json"), "utf8"));
    assert.deepEqual(shortcutLog.unregistered.sort(), ["Control+Alt+Enter", "Control+Alt+Space"], "Closing main must unregister compact shortcuts");
    const report = { status: "passed", checks: ["restricted compact preload", "native window security/options", "idle/paused/busy request guards", "shortcut callbacks without OS keypress", "locked reply target with later transcript", "snapshot streaming", "hide keeps meeting live", "main close cleans overlay and shortcuts"], fixture: "isolated Electron, synthetic transcript, owned provider" };
    await writeFile("test-results/compact-desktop.json", JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  } finally {
    await instance?.close().catch(() => {});
  }

  const conflictData = await mkdtemp(path.join(tmpdir(), "callme-compact-desktop-"));
  let conflict;
  try {
    conflict = await launch(conflictData, "Control+Alt+Enter");
    await conflict.main.evaluate(() => window.callme.showCompact());
    const compact = await compactPage(conflict.instance);
    const shortcuts = await compact.evaluate(() => window.callmeCompact.snapshot()).then(value => value.shortcuts);
    assert.equal(shortcuts.toggleRegistered, true); assert.equal(shortcuts.replyRegistered, false, "Shortcut conflict must be visible in compact snapshot");
  } finally { await conflict?.instance.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
