import { BrowserWindow, clipboard, globalShortcut, ipcMain, nativeTheme, screen, shell } from "electron";
import { lstat, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { CompactShortcuts, CompactSnapshot } from "./shared";

type Snapshot = Omit<CompactSnapshot, "shortcuts" | "error">;
interface Options {
  rendererFile: string; dataRoot: string; main: () => BrowserWindow;
  snapshot: () => Snapshot; ask: () => Promise<void>; cancel: () => Promise<void>;
  trustedMain: (event: Electron.IpcMainInvokeEvent) => void;
}
const TOGGLE = "Control+Alt+Space", REPLY = "Control+Alt+Enter";

/** A separate read-only view of the active meeting. It never acquires media. */
export class CompactWindow {
  private window: BrowserWindow | null = null;
  private creating: Promise<BrowserWindow> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private error = "";
  private disposed = false;
  private readonly url: string;
  private readonly stateFile: string;
  private persist: Promise<void> = Promise.resolve();
  private shortcuts: CompactShortcuts = { toggle: "Ctrl+Alt+Space", reply: "Ctrl+Alt+Enter", toggleRegistered: false, replyRegistered: false };
  constructor(private options: Options) {
    this.url = pathToFileURL(options.rendererFile).href + "#compact";
    this.stateFile = path.join(options.dataRoot, "compact-window.json");
    ipcMain.handle("compact:show", async event => { options.trustedMain(event); await this.show(true); });
    ipcMain.handle("compact:snapshot", event => { this.trusted(event); return this.snapshot(); });
    ipcMain.handle("compact:ask", async event => { this.trusted(event); await this.reply(); });
    ipcMain.handle("compact:cancel", async event => { this.trusted(event); await options.cancel(); });
    ipcMain.handle("compact:main", event => { this.trusted(event); const main = options.main(); if (main.isMinimized()) main.restore(); main.show(); main.focus(); });
    ipcMain.handle("compact:hide", event => { this.trusted(event); this.window?.hide(); });
    ipcMain.handle("compact:copy", event => {
      this.trusted(event); const answer = options.snapshot().answer;
      if (!answer || answer.state !== "done" || !answer.text) throw new Error("Готового ответа пока нет");
      clipboard.writeText(answer.text);
    });
    ipcMain.handle("compact:link", async (event, value: unknown) => {
      this.trusted(event);
      if (typeof value !== "string" || value.length > 2048) throw new Error("Некорректная ссылка");
      const url = new URL(value);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Можно открыть только веб-ссылку");
      await shell.openExternal(url.href);
    });
    try { this.shortcuts.toggleRegistered = globalShortcut.register(TOGGLE, () => { void this.toggle().catch(() => {}); }); } catch {}
    try { this.shortcuts.replyRegistered = globalShortcut.register(REPLY, () => { void this.show(false).then(() => { if (!this.options.snapshot().busy) return this.reply(); }).catch(() => {}); }); } catch {}
  }
  private trusted(event: Electron.IpcMainInvokeEvent) {
    if (!this.window || this.window.isDestroyed() || event.sender !== this.window.webContents || event.senderFrame !== this.window.webContents.mainFrame || event.senderFrame.url !== this.url) throw new Error("Недопустимый источник компактного окна");
  }
  private snapshot(): CompactSnapshot { return { ...this.options.snapshot(), error: this.error, shortcuts: { ...this.shortcuts } }; }
  clearError() { this.error = ""; this.publish(); }
  publish() {
    if (this.disposed || this.timer || !this.window || this.window.isDestroyed()) return;
    this.timer = setTimeout(() => { this.timer = null; if (this.window && !this.window.isDestroyed() && !this.window.webContents.isDestroyed()) this.window.webContents.send("compact:snapshot", this.snapshot()); }, 25);
  }
  async reply() {
    this.error = "";
    try { await this.options.ask(); }
    catch (error) { this.error = error instanceof Error ? error.message : "Не удалось запросить подсказку"; throw error; }
    finally { this.publish(); }
  }
  private async create(): Promise<BrowserWindow> {
    const area = screen.getDisplayMatching(this.options.main().getBounds()).workArea;
    let bounds = { x: area.x + area.width - 444, y: area.y + area.height - 548, width: 420, height: 500 };
    try {
      if ((await lstat(this.stateFile)).isSymbolicLink()) throw new Error("Linked window state");
      const saved = JSON.parse(await readFile(this.stateFile, "utf8"));
      if ([saved.x, saved.y, saved.width, saved.height].every(Number.isSafeInteger)) {
        const display = screen.getDisplayNearestPoint({ x: saved.x, y: saved.y }).workArea;
        bounds = { width: Math.min(Math.max(saved.width, 360), Math.min(720, display.width)), height: Math.min(Math.max(saved.height, 380), display.height), x: saved.x, y: saved.y };
        bounds.x = Math.max(display.x, Math.min(bounds.x, display.x + display.width - bounds.width));
        bounds.y = Math.max(display.y, Math.min(bounds.y, display.y + display.height - bounds.height));
      }
    } catch {}
    if (this.disposed) throw new Error("LazyCall закрывается");
    const window = new BrowserWindow({ ...bounds, minWidth: 360, minHeight: 380, maxWidth: 720, title: "LazyCall — подсказки", show: false, alwaysOnTop: true, skipTaskbar: true, autoHideMenuBar: true, minimizable: false, maximizable: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#12151b" : "#f1f3f6", icon: path.join(__dirname, "../assets/lazycall-icon.png"),
      webPreferences: { preload: path.join(__dirname, "compact-preload.js"), sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false }
    });
    this.window = window;
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => { if (url !== this.url) event.preventDefault(); });
    window.on("page-title-updated", event => { event.preventDefault(); });
    window.on("close", event => { if (!this.disposed) { event.preventDefault(); window.hide(); } });
    const save = () => {
      if (this.disposed || window.isDestroyed()) return;
      const saved = window.getBounds();
      this.persist = this.persist.then(async () => {
        try { if ((await lstat(this.stateFile)).isSymbolicLink()) return; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") return; }
        const temporary = this.stateFile + "." + randomUUID() + ".tmp";
        await writeFile(temporary, JSON.stringify(saved), { encoding: "utf8", mode: 0o600, flag: "wx" });
        await rename(temporary, this.stateFile);
      }).catch(() => {});
    };
    window.on("moved", save); window.on("resized", save);
    window.on("closed", () => { if (this.window === window) this.window = null; });
    try { await window.loadFile(this.options.rendererFile, { hash: "compact" }); }
    catch (error) { window.destroy(); throw error; }
    if (this.disposed || window.isDestroyed()) throw new Error("LazyCall закрывается");
    return window;
  }
  async show(focus: boolean) {
    if (this.disposed) return;
    if (!this.window || this.window.isDestroyed()) {
      this.creating ??= this.create().finally(() => { this.creating = null; });
      await this.creating;
    } else if (this.creating) await this.creating;
    if (!this.window || this.window.isDestroyed() || this.disposed) return;
    this.window.setAlwaysOnTop(true); this.publish();
    if (focus) this.window.show(); else this.window.showInactive();
  }
  private async toggle() { if (this.window?.isVisible()) this.window.hide(); else await this.show(false); }
  ownSourceId(): string | undefined { return this.window && !this.window.isDestroyed() ? this.window.getMediaSourceId() : undefined; }
  themeChanged() { if (this.window && !this.window.isDestroyed()) this.window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#12151b" : "#f1f3f6"); this.publish(); }
  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.shortcuts.toggleRegistered) globalShortcut.unregister(TOGGLE);
    if (this.shortcuts.replyRegistered) globalShortcut.unregister(REPLY);
    this.shortcuts.toggleRegistered = false; this.shortcuts.replyRegistered = false;
    this.window?.destroy(); this.window = null;
  }
}
