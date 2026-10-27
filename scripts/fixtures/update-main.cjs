/*
 * Minimal Electron process used only by check-updates-desktop.cjs.  It loads
 * the production Updates adapter with a real NsisUpdater, but never creates a
 * window or starts an installer.
 */
const { app } = require("electron");
const { mkdir, readdir, stat, writeFile } = require("node:fs/promises");
const path = require("node:path");

const report = { scenario: process.env.CALLME_UPDATE_SCENARIO, events: [], quitAndInstallCalls: 0 };

async function filesBelow(root) {
  const result = [];
  async function visit(directory) {
    let entries = [];
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else result.push(path.relative(root, file).replaceAll("\\", "/"));
    }
  }
  await visit(root);
  return result.sort();
}

async function finish(error) {
  if (error) report.failure = error instanceof Error ? error.stack || error.message : String(error);
  report.userData = app.getPath("userData");
  report.temp = app.getPath("temp");
  report.localAppData = process.env.LOCALAPPDATA;
  report.cacheFiles = await filesBelow(process.env.LOCALAPPDATA);
  await mkdir(path.dirname(process.env.CALLME_UPDATE_REPORT), { recursive: true });
  await writeFile(process.env.CALLME_UPDATE_REPORT, JSON.stringify(report, null, 2));
  app.exit(error ? 1 : 0);
}

app.setPath("userData", process.env.CALLME_UPDATE_USER_DATA);
app.setPath("temp", process.env.CALLME_UPDATE_TEMP);

app.whenReady().then(async () => {
  try {
    const { NsisUpdater } = require(path.join(process.env.CALLME_PROJECT_ROOT, "node_modules", "electron-updater"));
    const { Updates } = require(path.join(process.env.CALLME_PROJECT_ROOT, "dist-electron", "updates.js"));
    const updater = new NsisUpdater();
    updater.logger = { info() {}, warn() {}, error() {} };
    // This disposable fixture has no packaged asar.  The flag merely enables
    // the updater's dev guard; its feed is still explicitly localhost below.
    updater.forceDevUpdateConfig = true;
    updater.disableDifferentialDownload = true;
    // The fixture byte stream is not a Windows-signed executable.  SHA512 is
    // still verified by electron-updater; this replacement exists only here.
    updater.verifyUpdateCodeSignature = async () => null;
    updater.on("error", error => { report.updaterError = error instanceof Error ? error.stack || error.message : String(error); });
    updater.quitAndInstall = (silent, restart) => {
      report.quitAndInstallCalls += 1;
      report.quitAndInstallArgs = [silent, restart];
    };
    updater.setFeedURL({ provider: "generic", url: process.env.CALLME_UPDATE_FEED });

    const updates = new Updates("0.3.5-alpha.1", status => report.events.push(status));
    updates.attach(updater);
    report.driver = {
      autoDownload: updater.autoDownload,
      autoInstallOnAppQuit: updater.autoInstallOnAppQuit,
      allowPrerelease: updater.allowPrerelease,
      allowDowngrade: updater.allowDowngrade,
      disableWebInstaller: updater.disableWebInstaller
    };

    await updates.check();
    report.afterCheck = updates.status;
    if (process.env.CALLME_UPDATE_RETRY_FEED) {
      updater.setFeedURL({ provider: "generic", url: process.env.CALLME_UPDATE_RETRY_FEED });
      await updates.check();
      report.afterRetry = updates.status;
    }
    if (process.env.CALLME_UPDATE_DOWNLOAD === "true") {
      report.beforeDownload = updates.status;
      await updates.download();
      report.afterDownload = updates.status;
      if (updates.status.state === "downloaded") {
        let prepared = false;
        updates.install(false, () => { prepared = true; });
        report.preparedForInstall = prepared;
      } else {
        try { updates.install(false, () => { throw new Error("must not prepare failed update"); }); }
        catch (error) { report.installRejected = error instanceof Error ? error.message : String(error); }
      }
    }
    await finish();
  } catch (error) {
    await finish(error);
  }
}).catch(finish);
