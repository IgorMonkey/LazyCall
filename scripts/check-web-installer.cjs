const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const { createReadStream } = require("node:fs");
const { access, mkdtemp, readFile, readdir, rm, stat, writeFile } = require("node:fs/promises");
const { spawn } = require("node:child_process");
const { _electron: electron } = require("playwright");
const os = require("node:os");
const path = require("node:path");

const project = path.resolve(__dirname, "..");
const previewOutput = path.join(project, "release", "lazycall-web-preview");
const stage = path.join(project, "release", "public-review", "win-unpacked");
const serverScript = path.join(project, "scripts", "serve-web-preview.cjs");

async function hash(file) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}

async function run(executable, args, options = {}) {
  const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], ...options });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", value => { stdout += value; });
  child.stderr.on("data", value => { stderr += value; });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", value => resolve(value ?? 1)); });
  return { code, stdout, stderr };
}

async function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    child.previewLog = output;
    const timeout = setTimeout(() => reject(new Error("Preview server did not start")), 10_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      output += chunk;
      child.previewLog = output;
      if (output.includes('"event":"listening"')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("exit", code => { clearTimeout(timeout); reject(new Error("Preview server exited early: " + code)); });
  });
}

async function startServer(badPayload) {
  const child = spawn(process.execPath, [serverScript, "--throttle-mbps", "1000", ...(badPayload ? ["--bad-payload"] : [])], {
    cwd: project,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer(child);
  return child;
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise(resolve => child.once("exit", resolve));
}

async function listFiles(root) {
  const result = new Map();
  async function walk(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Smoke input must not contain symbolic links");
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) result.set(path.relative(root, file).replaceAll("\\", "/"), file);
      else throw new Error("Unsupported smoke input entry");
    }
  }
  await walk(root);
  return result;
}

async function assertInstalled(stageFiles, installDirectory) {
  for (const [relative, source] of stageFiles) {
    const targetRelative = relative === "LazyCall.exe" ? "LazyCallWebPreview.exe" : relative;
    const installed = path.join(installDirectory, ...targetRelative.split("/"));
    await access(installed);
    assert.equal(await hash(installed), await hash(source), "Installed file differs: " + targetRelative);
  }
  await access(path.join(installDirectory, "LazyCallWebPreview.exe"));
}

async function assertPreviewLaunch(installDirectory, temporaryParent) {
  const executable = path.join(installDirectory, "LazyCallWebPreview.exe");
  const userData = path.join(temporaryParent, "runtime-profile-" + randomUUID());
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const instance = await electron.launch({
    executablePath: executable,
    args: ["--user-data-dir=" + userData],
    env,
    timeout: 30_000,
  });
  try {
    const runtime = await instance.evaluate(({ app }) => ({ name: app.getName(), userData: app.getPath("userData") }));
    assert.equal(runtime.name, "LazyCallWebPreview", "Preview process must use its isolated app name");
    assert.ok(path.resolve(runtime.userData).toLowerCase().startsWith(path.resolve(temporaryParent).toLowerCase() + path.sep), "Preview process wrote user data outside the owned smoke directory");
    assert.equal(path.resolve(runtime.userData).toLowerCase(), path.resolve(userData).toLowerCase(), "Preview process ignored the isolated user-data directory");
  } finally {
    await instance.close();
  }
}

async function assertVCRuntimePresent() {
  const result = await run("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    "$r=Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64'; if($r.Installed -eq 1 -and ($r.Major -gt 14 -or ($r.Major -eq 14 -and ($r.Minor -gt 51 -or ($r.Minor -eq 51 -and $r.Bld -ge 36247))))){exit 0}; exit 3",
  ]);
  assert.equal(result.code, 0, "VC runtime prerequisite is absent; smoke refuses to trigger Microsoft installer");
}

function assertPreviewInstaller(file) {
  const expectedRoot = path.join(previewOutput, "nsis-web").toLowerCase() + path.sep;
  assert.ok(file.toLowerCase().startsWith(expectedRoot), "Installer must be inside the isolated preview output");
  assert.match(path.basename(file), /^LazyCallWebPreview Web Setup .+\.exe$/);
}

async function findInstaller(manifest) {
  const installer = path.resolve(project, manifest.installer);
  assertPreviewInstaller(installer);
  await access(installer);
  return installer;
}

(async () => {
  const manifest = JSON.parse(await readFile(path.join(previewOutput, "web-installer-manifest.json"), "utf8"));
  assert.equal(manifest.mode, "local-preview");
  assert.equal(manifest.identity?.appId, "local.lazycall.webpreview");
  assert.equal(manifest.identity?.executableName, "LazyCallWebPreview");
  const installer = await findInstaller(manifest);
  await assertVCRuntimePresent();
  const stageFiles = await listFiles(stage);
  const temporaryParent = await mkdtemp(path.join(os.tmpdir(), "LazyCallWebInstallerSmoke-"));
  const installDirectory = path.join(temporaryParent, "LazyCallWebPreview-" + randomUUID());
  let server;
  try {
    server = await startServer(false);
    let result = await run(installer, ["/S", "/D=" + installDirectory]);
    assert.equal(result.code, 0, "Normal preview install failed: " + result.stderr + " Server: " + (server.previewLog || ""));
    await stop(server); server = undefined;
    await assertInstalled(stageFiles, installDirectory);
    await assertPreviewLaunch(installDirectory, temporaryParent);

    const canary = path.join(installDirectory, "callme-smoke-canary.txt");
    await writeFile(canary, "must survive corrupt web payload", "utf8");
    server = await startServer(true);
    result = await run(installer, ["/S", "/D=" + installDirectory]);
    assert.equal(result.code, 2, "Corrupt payload must fail before touching the installed preview");
    await stop(server); server = undefined;
    assert.equal(await readFile(canary, "utf8"), "must survive corrupt web payload");
    await assertInstalled(stageFiles, installDirectory);

    server = await startServer(false);
    result = await run(installer, ["/S", "/D=" + installDirectory]);
    assert.equal(result.code, 0, "Retry after corrupt payload failed: " + result.stderr);
    await stop(server); server = undefined;
    await assertInstalled(stageFiles, installDirectory);

    const installedEntries = await readdir(installDirectory);
    const uninstaller = installedEntries.find(name => /^Uninstall .*LazyCallWebPreview.*\.exe$/i.test(name));
    assert.ok(uninstaller, "Preview uninstaller was not created");
    const uninstallerPath = path.join(installDirectory, uninstaller);
    assert.ok(uninstallerPath.toLowerCase().startsWith(installDirectory.toLowerCase() + path.sep), "Uninstaller must stay in the owned preview directory");
    result = await run(uninstallerPath, ["/S"]);
    assert.equal(result.code, 0, "Preview uninstall failed: " + result.stderr);
    await assert.rejects(access(path.join(installDirectory, "LazyCallWebPreview.exe")));
    console.log(JSON.stringify({ status: "passed", installer, installDirectory: "removed", stageFiles: stageFiles.size }));
  } finally {
    await stop(server);
    await rm(temporaryParent, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
