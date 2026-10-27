// Isolated compact-window renderer check. It uses only the compact preload contract.
const { chromium } = require("playwright");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { checkSpacing } = require("./ui-spacing.cjs");

(async () => {
  const root = path.resolve(process.env.CALLME_UI_DIST || "dist");
  const server = http.createServer(async (req, res) => {
    try {
      const file = path.resolve(root, req.url === "/" ? "index.html" : "." + decodeURIComponent(req.url.split("?")[0]));
      if (!file.startsWith(root + path.sep)) throw Error("path");
      res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" })[path.extname(file)] || "application/octet-stream");
      res.end(await fs.readFile(file));
    } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 404, height: 461 } });
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      let listener;
      let state = {
        phase: "idle", theme: "light", agent: { state: "ready", label: "Codex подключён" }, target: null, answer: null, answerTarget: null, busy: false, error: "",
        shortcuts: { toggle: "Ctrl+Alt+Space", reply: "Ctrl+Alt+Enter", toggleRegistered: true, replyRegistered: true }
      };
      window.compactFixture = { asked: 0, cancelled: 0, opened: 0, hidden: 0, copied: 0, links: [], emit(value) { state = { ...state, ...value }; listener?.(structuredClone(state)); } };
      window.callmeCompact = {
        snapshot: async () => structuredClone(state),
        onSnapshot: fn => { listener = fn; return () => { listener = undefined; }; },
        ask: async () => { window.compactFixture.asked++; },
        cancel: async () => { window.compactFixture.cancelled++; },
        showMain: async () => { window.compactFixture.opened++; },
        hide: async () => { window.compactFixture.hidden++; },
        copyAnswer: async () => { window.compactFixture.copied++; },
        openLink: async url => { window.compactFixture.links.push(url); }
      };
    });
    await page.goto(`http://127.0.0.1:${port}/#compact`);
    await page.getByRole("main", { name: "Подсказки LazyCall" }).waitFor();
    await page.getByText("Начните запись в основном окне", { exact: false }).waitFor();
    assert(await page.getByRole("button", { name: "Подсказать ответ" }).isDisabled(), "idle compact action must be disabled");
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => window.compactFixture.hidden), 1, "Escape did not request compact hide");
    await page.evaluate(() => window.compactFixture.emit({ shortcuts: { toggle: "Ctrl+Alt+Space", reply: "Ctrl+Alt+Enter", toggleRegistered: false, replyRegistered: false } }));
    await page.getByText("Ctrl+Alt+Space — недоступно или занято", { exact: false }).waitFor();
    await page.getByText("Ctrl+Alt+Enter — недоступно или занято", { exact: false }).waitFor();
    await page.evaluate(() => window.compactFixture.emit({ shortcuts: { toggle: "Ctrl+Alt+Space", reply: "Ctrl+Alt+Enter", toggleRegistered: true, replyRegistered: true } }));
    await page.getByRole("button", { name: "Открыть LazyCall" }).click();
    assert.equal(await page.evaluate(() => window.compactFixture.opened), 1, "main window was not requested");

    await page.evaluate(() => window.compactFixture.emit({ phase: "paused" }));
    await page.getByText("Запись на паузе", { exact: false }).waitFor();
    assert(await page.getByRole("button", { name: "Подсказать ответ" }).isDisabled(), "paused compact action must be disabled");
    await page.evaluate(() => window.compactFixture.emit({ phase: "done" }));
    await page.getByText("Запись завершена", { exact: false }).waitFor();
    await page.evaluate(() => window.compactFixture.emit({ phase: "live", agent: { state: "login", label: "Войдите через ChatGPT" } }));
    await page.getByText("Подсказка будет доступна после подключения помощника.", { exact: true }).waitFor();

    await page.evaluate(() => window.compactFixture.emit({
      phase: "live", agent: { state: "ready", label: "Codex подключён" }, target: { id: "remote-15", source: "remote", startMs: 15_000, endMs: 17_000, text: "Когда будет готова проверка?" },
      answer: null, answerTarget: null, busy: false, error: ""
    }));
    await page.getByText("Последняя реплика", { exact: true }).waitFor();
    await page.getByText("00:15", { exact: true }).waitFor();
    const hint = page.getByRole("button", { name: "Подсказать ответ" });
    assert(!await hint.isDisabled(), "live remote line must enable quick reply");
    await hint.focus();
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Подсказать ответ", "quick reply must be keyboard focusable");
    await hint.press("Enter");
    assert.equal(await page.evaluate(() => window.compactFixture.asked), 1, "quick reply was not sent through compact API");
    await page.keyboard.press("Control+Enter");
    assert.equal(await page.evaluate(() => window.compactFixture.asked), 2, "local Ctrl+Enter did not request a reply");

    await page.evaluate(() => window.compactFixture.emit({
      busy: true,
      answerTarget: { id: "remote-15", source: "remote", startMs: 15_000, endMs: 17_000, text: "Когда будет готова проверка?" },
      answer: { id: "answer-1", role: "assistant", kind: "answer", state: "streaming", createdAt: Date.now(), text: "Проверка будет готова **сегодня**. https://example.test/details" }
    }));
    await page.getByText("Ответ на 00:15").waitFor();
    await page.getByText("Готовит ответ…", { exact: true }).waitFor();
    await page.evaluate(() => window.compactFixture.emit({ answer: { id: "answer-1", role: "assistant", kind: "answer", state: "streaming", createdAt: Date.now(), text: "", context: { projectName: "Проект", repository: "connected", brief: true, documents: 0 }, progress: { stage: "reading", filesRead: 2 } } }));
    await page.getByText("Читает файлы проекта: 2…", { exact: true }).first().waitFor();
    await page.screenshot({ path: "test-results/compact-project-reading.png" });
    await page.evaluate(() => window.compactFixture.emit({ answer: { id: "answer-1", role: "assistant", kind: "answer", state: "streaming", createdAt: Date.now(), text: "Проверка будет готова **сегодня**. https://example.test/details" } }));
    await page.getByRole("link", { name: "https://example.test/details" }).click();
    assert.deepEqual(await page.evaluate(() => window.compactFixture.links), ["https://example.test/details"], "answer link bypassed compact bridge");
    await page.getByRole("button", { name: "Остановить" }).click();
    assert.equal(await page.evaluate(() => window.compactFixture.cancelled), 1, "stream cancel was not sent through compact API");

    await page.evaluate(() => window.compactFixture.emit({ busy: false, answer: { id: "answer-1", role: "assistant", kind: "answer", state: "done", createdAt: Date.now(), text: "Готово." } }));
    await page.getByRole("button", { name: "Копировать" }).click();
    assert.equal(await page.evaluate(() => window.compactFixture.copied), 1, "copy was not sent through compact API");
    await page.evaluate(() => window.compactFixture.emit({ busy: true }));
    const occupied = page.getByRole("button", { name: "Помощник занят" });
    assert(await occupied.isDisabled(), "a non-reply assistant task must not expose the cancel action");
    await page.evaluate(() => window.compactFixture.emit({ busy: false }));
    await page.evaluate(() => window.compactFixture.emit({
      target: { id: "remote-31", source: "remote", startMs: 31_000, endMs: 32_000, text: "А что дальше?" },
      answerTarget: { id: "remote-15", source: "remote", startMs: 15_000, endMs: 17_000, text: "Когда будет готова проверка?" }
    }));
    await page.getByText("Реплика для этого ответа", { exact: true }).waitFor();
    await page.screenshot({ path: "test-results/compact-live.png" });
    await checkSpacing(page, "compact-live");

    const longAnswer = Array.from({ length: 36 }, (_, index) => `Пункт ответа ${index + 1}: уточните срок и ответственного.`).join("\n\n");
    await page.evaluate(text => window.compactFixture.emit({ theme: "dark", busy: true, error: "", answer: { id: "answer-2", role: "assistant", kind: "answer", state: "streaming", createdAt: Date.now(), text } }), longAnswer);
    const content = page.locator(".compact-content");
    await page.waitForFunction(() => {
      const node = document.querySelector(".compact-content");
      return !!node && node.scrollHeight > node.clientHeight;
    });
    assert(await content.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight <= 24), "streaming answer did not follow the latest content");
    await content.evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event("scroll")); });
    await page.evaluate(text => window.compactFixture.emit({ answer: { id: "answer-2", role: "assistant", kind: "answer", state: "streaming", createdAt: Date.now(), text: text + "\n\nЕщё одна часть ответа." } }), longAnswer);
    await page.getByRole("button", { name: "К последнему ответу" }).waitFor();
    assert(await content.evaluate(node => node.scrollTop < 8), "manual reading position was hijacked by a stream update");
    await page.getByRole("button", { name: "К последнему ответу" }).click();
    assert(await content.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight <= 24), "follow button did not return to latest answer");
    await page.evaluate(() => window.compactFixture.emit({ busy: false, error: "Не удалось получить ответ. Проверьте подключение и повторите запрос." }));
    await page.getByRole("alert").waitFor();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark", "snapshot theme was not applied");
    const colors = await page.evaluate(() => ({ fg: getComputedStyle(document.querySelector(".compact-state-error")).color, bg: getComputedStyle(document.querySelector(".compact-state-error")).backgroundColor }));
    assert.notEqual(colors.fg, colors.bg, "dark error text is not readable");
    await page.screenshot({ path: "test-results/compact-dark-error.png" });
    await checkSpacing(page, "compact-dark-error");

    assert(!await page.getByRole("button", { name: "Подсказать ответ" }).isDisabled(), "a failed request must allow retry");
    await page.setViewportSize({ width: 344, height: 340 });
    const layout = await page.evaluate(() => {
      const action = document.querySelector(".compact-actions")?.getBoundingClientRect();
      const footer = document.querySelector(".compact-shortcuts")?.getBoundingClientRect();
      const answer = document.querySelector(".compact-answer");
      return { overflowX: document.documentElement.scrollWidth > innerWidth + 1, overflowY: document.documentElement.scrollHeight > innerHeight + 1,
        actionVisible: !!action && action.bottom <= innerHeight, footerVisible: !!footer && footer.bottom <= innerHeight,
        singleScroll: getComputedStyle(answer).overflowY !== "auto" && getComputedStyle(answer).overflowY !== "scroll" };
    });
    assert(!layout.overflowX && !layout.overflowY, "compact window document overflows at minimum size");
    assert(layout.actionVisible && layout.footerVisible, "compact actions or shortcut footer are clipped at native minimum size");
    assert(layout.singleScroll, "answer introduced a second scroll region");
    await page.evaluate(() => window.compactFixture.emit({ busy: false, error: "", answerTarget: { id: "remote-31", source: "remote", startMs: 31_000, endMs: 32_000, text: "А что дальше?" }, answer: { id: "answer-3", role: "assistant", kind: "answer", state: "done", createdAt: Date.now(), text: "Проверю доступ и пришлю результат сегодня." } }));
    await page.waitForFunction(() => !document.querySelector(".compact-actions button")?.disabled && !document.querySelector('[role="alert"]'));
    await page.screenshot({ path: "test-results/compact-narrow.png", animations: "disabled" });
    await checkSpacing(page, "compact-narrow");
    assert.deepEqual(errors, [], "renderer errors");
    console.log(JSON.stringify({ status: "passed", screenshots: ["compact-live.png", "compact-dark-error.png", "compact-narrow.png"] }));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
