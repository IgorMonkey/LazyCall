/*
 * Exercises electron-updater's real Windows NsisUpdater in a disposable
 * Electron app.  The server is bound to localhost and serves synthetic bytes;
 * quitAndInstall is replaced inside the fixture before Updates.attach().
 */
const { createServer } = require("node:http");
const { createHash, randomBytes } = require("node:crypto");
const { mkdtemp, mkdir, readFile, rm, writeFile } = require("node:fs/promises");
const { spawn } = require("node:child_process");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const project = path.resolve(__dirname, "..");
const fixtureMain = path.join(project, "scripts", "fixtures", "update-main.cjs");
const reportPath = path.join(project, "test-results", "updates-desktop-check.json");
const rootPrefix = "callme-updater-real-";
const payload = Buffer.concat([Buffer.from("MZ-callme-updater-fixture\n"), randomBytes(2 * 1024 * 1024)]);
const validSha512 = createHash("sha512").update(payload).digest("base64");

function yaml(version, sha512) {
  const file = `LazyCall-${version}.exe`;
  return [
    `version: ${version}`,
    "files:",
    `  - url: ${file}`,
    `    sha512: ${sha512}`,
    `    size: ${payload.length}`,
    `path: ${file}`,
    `sha512: ${sha512}`,
    `releaseDate: '2026-10-27T00:00:00.000Z'`,
    ""
  ].join("\n");
}

function startFeed() {
  const releases = new Map([
    ["good", { version: "0.3.5-alpha.2", sha512: validSha512 }],
    ["bad", { version: "0.3.5-alpha.2", sha512: createHash("sha512").update("wrong").digest("base64") }],
    ["older", { version: "0.3.4", sha512: validSha512 }]
  ]);
  const server = createServer((request, response) => {
    const parts = new URL(request.url, "http://127.0.0.1").pathname.split("/").filter(Boolean);
    const release = releases.get(parts[0]);
    if (!release) { response.writeHead(404); response.end(); return; }
    if (parts[1] === "latest.yml") {
      response.writeHead(200, { "content-type": "text/yaml", "cache-control": "no-store" });
      response.end(yaml(release.version, release.sha512));
      return;
    }
    if (parts[1] === `LazyCall-${release.version}.exe`) {
      response.writeHead(200, { "content-type": "application/octet-stream", "content-length": payload.length });
      let offset = 0;
      const timer = setInterval(() => {
        if (offset >= payload.length) { clearInterval(timer); response.end(); return; }
        const next = Math.min(offset + 64 * 1024, payload.length);
        response.write(payload.subarray(offset, next));
        offset = next;
      }, 6);
      response.on("close", () => clearInterval(timer));
      return;
    }
    response.writeHead(404); response.end();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: name => `http://127.0.0.1:${port}/${name}` });
    });
  });
}

// This is a wire-level provider check: the real GitHubProvider parses a
// synthetic Atom feed through its executor.  No GitHub request is made.
async function verifyGitHubProviderWire() {
  const { GitHubProvider } = require("electron-updater/out/providers/GitHubProvider");
  const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><title>v0.3.5-alpha.2</title><link href="https://github.com/IgorMonkey/LazyCall/releases/tag/v0.3.5-alpha.2"/><content>alpha</content></entry>
  <entry><title>v0.3.5</title><link href="https://github.com/IgorMonkey/LazyCall/releases/tag/v0.3.5"/><content>stable</content></entry>
</feed>`;
  const response = version => `version: ${version}\nfiles:\n  - url: LazyCall.exe\n    sha512: fixture\n`;
  const createExecutor = requests => ({
    async request(options) {
      const url = `${options.protocol}//${options.hostname || options.host}${options.path}`;
      requests.push(url);
      if (url === "https://github.com/IgorMonkey/LazyCall/releases.atom") return atom;
      if (url === "https://github.com/IgorMonkey/LazyCall/releases/latest") return JSON.stringify({ tag_name: "v0.3.5" });
      if (url === "https://github.com/IgorMonkey/LazyCall/releases/download/v0.3.5-alpha.2/alpha.yml") return response("0.3.5-alpha.2");
      if (url === "https://github.com/IgorMonkey/LazyCall/releases/download/v0.3.5/latest.yml") return response("0.3.5");
      throw new Error(`Unexpected GitHub provider request: ${url}`);
    }
  });
  const providerOptions = { provider: "github", owner: "IgorMonkey", repo: "LazyCall" };
  const alphaRequests = [];
  const alphaUpdater = { allowPrerelease: true, currentVersion: "0.3.5-alpha.1", channel: null, fullChangelog: false };
  const alpha = new GitHubProvider(providerOptions, alphaUpdater, { executor: createExecutor(alphaRequests), platform: "win32" });
  const alphaResult = await alpha.getLatestVersion();
  assert.equal(alphaResult.version, "0.3.5-alpha.2");
  assert.equal(alphaResult.tag, "v0.3.5-alpha.2");
  assert.deepEqual(alphaRequests, [
    "https://github.com/IgorMonkey/LazyCall/releases.atom",
    "https://github.com/IgorMonkey/LazyCall/releases/download/v0.3.5-alpha.2/alpha.yml"
  ]);

  const stableRequests = [];
  const stableUpdater = { allowPrerelease: false, currentVersion: "0.3.4", channel: null, fullChangelog: false };
  const stable = new GitHubProvider(providerOptions, stableUpdater, { executor: createExecutor(stableRequests), platform: "win32" });
  const stableResult = await stable.getLatestVersion();
  assert.equal(stableResult.version, "0.3.5");
  assert.equal(stableResult.tag, "v0.3.5");
  assert.deepEqual(stableRequests, [
    "https://github.com/IgorMonkey/LazyCall/releases.atom",
    "https://github.com/IgorMonkey/LazyCall/releases/latest",
    "https://github.com/IgorMonkey/LazyCall/releases/download/v0.3.5/latest.yml"
  ]);
  return { alphaRequests, stableRequests, alphaVersion: alphaResult.version, stableVersion: stableResult.version };
}

function run(executable, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, ...options });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", code => resolve({ code, stdout, stderr }));
  });
}

async function runScenario(root, name, options) {
  const scenarioRoot = path.join(root, name);
  const appRoot = path.join(scenarioRoot, "app");
  const report = path.join(scenarioRoot, "report.json");
  const userData = path.join(scenarioRoot, "user-data");
  const localAppData = path.join(scenarioRoot, "local-app-data");
  await mkdir(appRoot, { recursive: true });
  await writeFile(path.join(appRoot, "package.json"), JSON.stringify({ name: "callme-update-fixture", version: "0.3.5-alpha.1", main: fixtureMain }));
  // forceDevUpdateConfig still reads this file for the cache directory while
  // the updater client itself is set explicitly in the fixture.
  await writeFile(path.join(appRoot, "dev-app-update.yml"), `provider: generic\nurl: ${options.feed}\nupdaterCacheDirName: callme-update-fixture\n`);
  const electron = require("electron");
  const environment = {
    ...process.env,
    CALLME_PROJECT_ROOT: project,
    CALLME_UPDATE_SCENARIO: name,
    CALLME_UPDATE_REPORT: report,
    CALLME_UPDATE_USER_DATA: userData,
    CALLME_UPDATE_TEMP: path.join(scenarioRoot, "temp"),
    CALLME_UPDATE_FEED: options.feed,
    CALLME_UPDATE_RETRY_FEED: options.retryFeed || "",
    CALLME_UPDATE_DOWNLOAD: options.download ? "true" : "false",
    LOCALAPPDATA: localAppData,
    APPDATA: path.join(scenarioRoot, "app-data"),
    TEMP: path.join(scenarioRoot, "temp"),
    TMP: path.join(scenarioRoot, "temp")
  };
  const result = await run(electron, [appRoot], { env: environment, cwd: project });
  const data = JSON.parse(await readFile(report, "utf8"));
  assert.equal(result.code, 0, `${name} Electron fixture failed: ${data.failure || result.stderr || result.stdout}; status=${JSON.stringify(data.beforeDownload || data.afterCheck)}`);
  assert.equal(data.failure, undefined, `${name} fixture error: ${data.failure}`);
  assert.equal(path.resolve(data.userData), path.resolve(userData), `${name} must use isolated userData`);
  assert.equal(path.resolve(data.localAppData), path.resolve(localAppData), `${name} must use isolated LOCALAPPDATA`);
  return { ...data, process: result, paths: { userData, localAppData } };
}

async function main() {
  const root = await mkdtemp(path.join(tmpdir(), rootPrefix));
  assert.equal(path.dirname(path.resolve(root)).toLowerCase(), path.resolve(tmpdir()).toLowerCase(), "Temp root escaped system temp");
  const report = { root, cleanup: "pending", electronUpdater: require("electron-updater/package.json").version, scenarios: {} };
  let feed;
  try {
    report.githubProviderWire = await verifyGitHubProviderWire();
    feed = await startFeed();
    const good = await runScenario(root, "good", { feed: feed.url("good"), download: true });
    report.scenarios.good = { afterCheck: good.afterCheck, beforeDownload: good.beforeDownload, afterDownload: good.afterDownload, updaterError: good.updaterError, cacheFiles: good.cacheFiles };
    assert.equal(good.driver.autoDownload, false);
    assert.equal(good.driver.autoInstallOnAppQuit, false);
    assert.equal(good.driver.allowPrerelease, true);
    assert.equal(good.driver.allowDowngrade, false);
    assert.equal(good.driver.disableWebInstaller, true);
    assert.equal(good.afterCheck.state, "available");
    assert.equal(good.afterDownload.state, "downloaded");
    assert.equal(good.preparedForInstall, true);
    assert.equal(good.quitAndInstallCalls, 1, "only fixture stub may receive install");
    assert.deepEqual(good.quitAndInstallArgs, [false, false]);
    assert(good.events.some(event => event.state === "downloading" && event.percent > 0), "real byte stream must emit download progress");
    assert(good.events.some(event => event.state === "downloaded" && event.percent === 100), "verified update must become ready");
    Object.assign(report.scenarios.good, { progressEvents: good.events.filter(event => event.state === "downloading").length, quitAndInstallCalls: good.quitAndInstallCalls });

    const bad = await runScenario(root, "bad-sha512", { feed: feed.url("bad"), download: true });
    assert.equal(bad.afterCheck.state, "available");
    assert.equal(bad.afterDownload.state, "error");
    assert.equal(bad.quitAndInstallCalls, 0, "checksum failure must never request install");
    assert.match(bad.installRejected, /ещё не готово/i);
    assert(!bad.cacheFiles.some(file => /pending|LazyCall-0\.3\.5-alpha\.2\.exe/i.test(file)), "invalid payload must not remain installable in cache");
    report.scenarios.badSha512 = { afterDownload: bad.afterDownload, cacheFiles: bad.cacheFiles, quitAndInstallCalls: bad.quitAndInstallCalls };

    const offline = await runScenario(root, "offline-retry", { feed: "http://127.0.0.1:9/offline", retryFeed: feed.url("good") });
    assert.equal(offline.afterCheck.state, "error");
    assert.equal(offline.afterCheck.message, "Не удалось проверить обновления. Повторите попытку позже.");
    assert.equal(offline.afterRetry.state, "available");
    report.scenarios.offlineRetry = { afterCheck: offline.afterCheck, afterRetry: offline.afterRetry };

    const older = await runScenario(root, "downgrade", { feed: feed.url("older") });
    assert.equal(older.driver.allowDowngrade, false);
    assert.equal(older.afterCheck.state, "idle");
    report.scenarios.downgrade = { afterCheck: older.afterCheck, allowDowngrade: older.driver.allowDowngrade };
    report.result = "passed";
  } catch (error) {
    report.result = "failed";
    report.error = error instanceof Error ? error.stack || error.message : String(error);
    throw error;
  } finally {
    if (feed) await new Promise(resolve => feed.server.close(resolve));
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    await rm(root, { recursive: true, force: true });
    report.cleanup = "removed";
    await writeFile(reportPath, JSON.stringify(report, null, 2));
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
