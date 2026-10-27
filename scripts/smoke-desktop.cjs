const { _electron: electron } = require("playwright");
const { mkdtemp, mkdir, readFile, readdir } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

(async () => {
  const data = await mkdtemp(path.join(tmpdir(), "callme-desktop-test-"));
  await mkdir("test-results", { recursive: true });
  const env = { ...process.env, CALLME_TEST_DATA: data };
  delete env.ELECTRON_RUN_AS_NODE;
  const instance = await electron.launch({ executablePath: require("electron"), args: [process.cwd()], env, timeout: 30000 });
  const errors = [];
  try {
    const page = await instance.firstWindow();
    await require("./prepare-ui-fixture.cjs")(page);
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    await page.getByRole("heading", { name: "LazyCall", exact: true }).waitFor();
    await page.locator('[data-testid="stt-status"][data-state="ready"]').waitFor({ timeout: 150000 });
    await page.screenshot({ path: "test-results/desktop.png" });
    const runtime = await instance.evaluate(({ app }) => ({ electron: process.versions.electron, node: process.versions.node, data: app.getPath("userData") }));
    // Exercise actual native Whisper -> durable transcript -> renderer using synthetic fixture.
    const fixturePath = path.join(process.cwd(), "test-results", "speech-16k.wav");
    const fixture = await readFile(fixturePath);
    const view = new DataView(fixture.buffer, fixture.byteOffset, fixture.byteLength);
    let offset = 12, pcm;
    while (offset + 8 <= fixture.length) {
      const id = fixture.toString("ascii", offset, offset + 4);
      const length = view.getUint32(offset + 4, true);
      if (id === "data") { pcm = fixture.subarray(offset + 8, offset + 8 + length); break; }
      offset += 8 + length + (length % 2);
    }
    assert(pcm, "WAV data chunk missing");
    const startedSession = await page.evaluate(async () => {
      const windows = await window.callme.windows();
      if (!windows.length) throw new Error("No capture sources");
      await window.callme.selectWindow(windows[0].id);
      return window.callme.start();
    });
    const started = Date.now();
    await page.evaluate(bytes => {
      const pcm = Uint8Array.from(bytes);
      window.callme.audio("self", 0, pcm.byteLength / 32, pcm.buffer);
    }, Array.from(pcm));
    await page.locator(".utterance").first().waitFor({ timeout: 45000 });
    const inferenceMs = Date.now() - started;
    const text = await page.locator(".utterance p").allTextContents();
    assert(text.join(" ").length > 10, "Empty transcription");
    await page.evaluate(async sessionId => { await window.callme.note("Тестовая заметка", sessionId); await window.callme.stop(); }, startedSession.sessionId);
    const ids = await readdir(path.join(data, "sessions"));
    const journal = await readFile(path.join(data, "sessions", ids[0], "events.jsonl"), "utf8");
    const rows = journal.trim().split("\n").map(JSON.parse);
    assert(rows.some(r => r.type === "transcript.final"));
    assert(rows.some(r => r.type === "note.edited"));
    assert(rows.some(r => r.type === "session.stopped"));
    await page.screenshot({ path: "test-results/transcript.png" });
    const staleNoteRejected = await page.evaluate(async oldSessionId => {
      const next = await window.callme.start();
      let rejected = false;
      try { await window.callme.note("STALE_NOTE_MUST_NOT_PERSIST", oldSessionId); }
      catch { rejected = true; }
      await window.callme.stop();
      return rejected && next.sessionId !== oldSessionId;
    }, startedSession.sessionId);
    assert(staleNoteRejected, "Stale note from prior session must be rejected");
    for (const id of await readdir(path.join(data, "sessions"))) {
      assert(!(await readFile(path.join(data, "sessions", id, "events.jsonl"), "utf8")).includes("STALE_NOTE_MUST_NOT_PERSIST"));
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: "passed", runtime, transcription: text, inferenceMs, events: rows.length, staleNoteRejected, screenshot: path.resolve("test-results/transcript.png") }));
  } finally { await instance.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
