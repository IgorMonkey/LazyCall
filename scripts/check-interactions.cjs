const { _electron: electron } = require("playwright");
const { mkdtemp } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

(async () => {
  const data = await mkdtemp(path.join(tmpdir(), "callme-interactions-"));
  const env = { ...process.env, CALLME_TEST_DATA: data };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require("electron"), args: [process.cwd()], env, timeout: 30000 });
  try {
    const page = await app.firstWindow();
    await require("./prepare-ui-fixture.cjs")(page);
    await page.getByRole("heading", { name: "LazyCall", exact: true }).waitFor();
    await page.locator('[data-testid="stt-status"][data-state="ready"]').waitFor({ timeout: 150000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === "LazyCall")?.setSize(904, 641));
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Настройки", exact: true });
    const settle = () => page.evaluate(async () => {
      await Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getTiming().iterations ?? 1)).map(animation => animation.finished.catch(() => undefined)));
    });
    const language = page.getByRole("combobox", { name: "Язык речи", exact: true });
    const compute = page.getByRole("combobox", { name: "Обработка", exact: true });
    await language.focus();
    await page.keyboard.press("ArrowDown");
    assert.equal(await language.getAttribute("aria-expanded"), "true");
    await settle();
    await page.screenshot({ path: "test-results/settings-select-focus.png" });
    const listbox = page.getByRole("listbox");
    assert(await listbox.evaluate(menu => menu.matches(":popover-open")), "Select listbox should use the popover top layer");
    assert.equal(await page.getByRole("option", { name: "English", exact: true }).getAttribute("class").then(value => value?.includes("is-active")), true);
    await page.keyboard.press("Enter");
    assert.equal((await language.textContent())?.trim(), "English");
    await language.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    assert.equal((await language.textContent())?.trim(), "English", "Escape must cancel the pending choice");
    await language.focus();
    await language.evaluate(node => node.dispatchEvent(new KeyboardEvent("keydown", { key: "р", bubbles: true })));
    await page.keyboard.press("Enter");
    assert.equal((await language.textContent())?.trim(), "Русский", "Typeahead should select matching option");
    await compute.click();
    await dialog.locator(".settings-heading").click();
    await listbox.waitFor({ state: "hidden" });
    await language.focus();
    await page.keyboard.press("End");
    await page.keyboard.press("Tab");
    assert.equal((await language.textContent())?.trim(), "Определять автоматически", "Tab should commit active option");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "stt-compute", "Tab should advance from the combobox");
    const focusStyle = await language.evaluate(node => { node.focus(); const style = getComputedStyle(node); return { outline: style.outlineStyle, shadow: style.boxShadow }; });
    assert.equal(focusStyle.outline, "solid");
    assert(!focusStyle.shadow.includes("185, 76, 40"), "Focus halo must not be orange");
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await language.evaluate(node => getComputedStyle(node).transitionDuration);
    assert(reduced.split(",").every(duration => Number.parseFloat(duration) <= 0.011), `Reduced motion should suppress control transitions (${reduced})`);
    await page.getByRole("tab", { name: "Помощник", exact: true }).click();
    const scroll = await dialog.evaluate(node => {
      const body = node.querySelector(".settings-body");
      const styles = getComputedStyle(node);
      return { dialogOverflow: styles.overflowY, bodyScrollable: Boolean(body && body.scrollHeight > body.clientHeight), bodyOverflow: body && getComputedStyle(body).overflowY };
    });
    assert.equal(scroll.dialogOverflow, "hidden");
    assert.equal(scroll.bodyScrollable, true, "Settings must have one scrollable body at 904×641");
    assert.equal(scroll.bodyOverflow, "auto");
    await settle();
    await page.screenshot({ path: "test-results/settings-dialog-904x641.png" });
    console.log(JSON.stringify({ status: "passed", keyboard: ["arrows", "typeahead", "escape", "tab"], outsideClick: true, oneSettingsScroll: scroll.bodyScrollable, reducedMotion: reduced }));
  } finally {
    await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
