import { readFile } from "node:fs/promises";
import type { UpdateStatus } from "./shared";

export interface UpdateDriver {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  disableWebInstaller: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(silent?: boolean, restart?: boolean): void;
}

// The feed is embedded by the release build. Renderer input never selects a feed
// or executable. electron-updater verifies the downloaded artifact's SHA512.
export class Updates {
  private value: UpdateStatus;
  private operation: Promise<unknown> | null = null;
  private driver: UpdateDriver | null = null;
  private downloadedVersion: string | null = null;
  constructor(version: string, private readonly emit: (status: UpdateStatus) => void) {
    this.value = { state: "unconfigured", currentVersion: version, message: "Канал обновлений ещё не подключён" };
  }
  get status(): UpdateStatus { return { ...this.value }; }
  get canInstall(): boolean { return !!this.driver && !this.operation && this.value.state === "downloaded"; }
  private set(value: Partial<UpdateStatus>) { this.value = { currentVersion: this.value.currentVersion, ...value } as UpdateStatus; this.emit(this.status); }
  attach(driver: UpdateDriver) {
    if (this.driver) throw new Error("Канал обновлений уже подключён");
    this.driver = driver;
    driver.autoDownload = false;
    driver.autoInstallOnAppQuit = false;
    driver.allowPrerelease = this.value.currentVersion.includes("-");
    driver.allowDowngrade = false;
    // Updates use the complete offline installer, including when this version
    // was installed through the web bootstrap. No unverified secondary payload.
    driver.disableWebInstaller = true;
    driver.on("checking-for-update", () => this.set({ state: "checking" }));
    driver.on("update-available", info => this.set({ state: "available", version: info.version }));
    driver.on("update-not-available", () => this.set({ state: "idle", message: "Установлена актуальная версия" }));
    driver.on("download-progress", progress => this.set({ state: "downloading", version: this.value.version,
      percent: Math.min(100, Math.max(0, Number(progress.percent) || 0)), transferred: progress.transferred, total: progress.total }));
    driver.on("update-downloaded", info => {
      this.downloadedVersion = info.version;
      if (!this.operation) this.set({ state: "downloaded", version: info.version, percent: 100 });
    });
    driver.on("error", () => this.set({ state: "error", message: "Не удалось получить обновление. Проверьте подключение и повторите попытку." }));
    this.set({ state: "idle", message: "Можно проверить наличие новой версии" });
  }
  async check(): Promise<UpdateStatus> {
    if (!this.driver) return this.status;
    if (this.operation || this.value.state === "downloaded") return this.status;
    this.set({ state: "checking" });
    try { this.operation = Promise.resolve().then(() => this.driver!.checkForUpdates()); await this.operation; }
    catch { this.set({ state: "error", message: "Не удалось проверить обновления. Повторите попытку позже." }); }
    finally { this.operation = null; }
    return this.status;
  }
  async download(): Promise<void> {
    if (!this.driver || this.operation || this.value.state !== "available") throw new Error("Сначала проверьте наличие обновления");
    this.downloadedVersion = null;
    this.set({ state: "downloading", version: this.value.version, percent: 0 });
    try { this.operation = Promise.resolve().then(() => this.driver!.downloadUpdate()); await this.operation; }
    catch { this.set({ state: "error", message: "Загрузка не завершена. Проверьте обновления и повторите попытку." }); }
    finally {
      this.operation = null;
      if (this.downloadedVersion && this.status.state !== "error") this.set({ state: "downloaded", version: this.downloadedVersion, percent: 100 });
      this.downloadedVersion = null;
    }
  }
  install(blocked: boolean, prepareExit: () => void): void {
    if (blocked) throw new Error("Завершите запись и дождитесь сохранения перед установкой обновления");
    if (!this.canInstall) throw new Error("Обновление ещё не готово к установке");
    prepareExit();
    this.driver!.quitAndInstall(false, false);
  }
}

export async function hasReleaseFeed(file: string): Promise<boolean> {
  try {
    const config = await readFile(file, "utf8");
    // Accept the small generated GitHub schema only. Duplicate keys, alternate
    // hosts, tokens and custom URLs cannot override what was validated here.
    const values = new Map<string, string>();
    const allowed = new Set(["provider", "owner", "repo", "updaterCacheDirName"]);
    for (const line of config.split(/\r?\n/).filter(line => line.trim())) {
      const match = /^([A-Za-z]+): ([A-Za-z0-9_.-]+)$/.exec(line);
      if (!match || !allowed.has(match[1]) || values.has(match[1])) return false;
      values.set(match[1], match[2]);
    }
    return values.get("provider") === "github" && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(values.get("owner") || "")
      && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(values.get("repo") || "")
      && (!values.has("updaterCacheDirName") || values.get("updaterCacheDirName") === "callme-updater");
  } catch { return false; }
}
