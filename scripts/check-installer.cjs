const { createReadStream } = require("node:fs");
const { access, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { randomUUID } = require("node:crypto");
const { createHash } = require("node:crypto");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const project = path.resolve(__dirname, "..");
const output = path.resolve(process.env.CALLME_INSTALLER_OUTPUT || path.join(project, "release", "compact-offline"));
const unpacked = path.join(output, "win-unpacked");
const reportPath = path.join(project, "test-results", "installer-check.json");
const run = promisify(execFile);

async function filesBelow(root) {
  const result = [];
  const visit = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else result.push(path.relative(root, file).replaceAll("\\", "/"));
    }
  };
  await visit(root);
  return result.sort();
}

async function bytesBelow(root) {
  let total = 0;
  const visit = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else total += (await stat(file)).size;
    }
  };
  await visit(root);
  return total;
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function samePath(left, right) {
  return left.toLowerCase() === right.toLowerCase();
}

async function assertOwnedPayloadRoot(root) {
  const expectedParent = path.resolve(tmpdir());
  const absolute = path.resolve(root);
  assert(samePath(path.dirname(absolute), expectedParent), "Payload root must be a direct child of the system temp directory");
  assert(path.basename(absolute).startsWith("callme-installer-payload-"), "Unexpected payload root");
  const [resolvedParent, details] = await Promise.all([realpath(expectedParent), lstat(absolute)]);
  assert(details.isDirectory() && !details.isSymbolicLink(), "Payload root must be a real directory");
  const resolvedRoot = await realpath(absolute);
  assert(samePath(path.dirname(resolvedRoot), resolvedParent), "Resolved payload root escapes the system temp directory");
  return resolvedRoot;
}

async function assertNoSymbolicLinks(root) {
  const visit = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const details = await lstat(file);
      assert(!details.isSymbolicLink(), `Payload extraction contains a symbolic link: ${file}`);
      if (details.isDirectory()) await visit(file);
    }
  };
  await visit(root);
}

async function extractInstallerPayload(installer, destination) {
  const { getPath7za } = require("app-builder-lib/out/toolsets/7zip");
  const sevenZip = await getPath7za();
  try {
    const result = await run(sevenZip, ["x", installer, `-o${destination}`, "-y"], {
      windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 900_000
    });
    return { exitCode: 0, output: `${result.stdout}\n${result.stderr}`, tailWarning: false, sevenZip };
  } catch (error) {
    const output = `${error.stdout || ""}\n${error.stderr || ""}`;
    const exitCode = typeof error.code === "number" ? error.code : null;
    const tailWarning = /There are data after the end of archive/i.test(output);
    if (exitCode !== 1 || !tailWarning) throw error;
    return { exitCode, output, tailWarning, sevenZip };
  }
}

async function checkInstallerPayload(installer, unpacked, payload) {
  const root = await mkdtemp(path.join(tmpdir(), "callme-installer-payload-"));
  await assertOwnedPayloadRoot(root);
  Object.assign(payload, { attempted: true, root, cleanup: "pending" });
  try {
    const extraction = await extractInstallerPayload(installer, root);
    await assertNoSymbolicLinks(await assertOwnedPayloadRoot(root));
    const [stagedFiles, extractedFiles] = await Promise.all([filesBelow(unpacked), filesBelow(root)]);
    const [stagedBytes, extractedBytes] = await Promise.all([bytesBelow(unpacked), bytesBelow(root)]);
    Object.assign(payload, {
      stagedFiles: stagedFiles.length,
      stagedBytes,
      extractedFiles: extractedFiles.length,
      extractedBytes,
      sevenZip: extraction.sevenZip,
      sevenZipExitCode: extraction.exitCode,
      sevenZipTailWarning: extraction.tailWarning
    });
    assert.deepEqual(extractedFiles, stagedFiles, "Installer payload file set differs from win-unpacked");
    assert.equal(extractedBytes, stagedBytes, "Installer payload byte count differs from win-unpacked");
    for (const relative of stagedFiles) {
      const [staged, extracted] = await Promise.all([sha256(path.join(unpacked, relative)), sha256(path.join(root, relative))]);
      assert.equal(extracted, staged, `Installer payload hash mismatch: ${relative}`);
    }
    // NSIS leaves its own trailer after the embedded 7z stream. 7za reports this as exit 1.
    assert(extraction.exitCode === 0 || extraction.tailWarning, "7za extraction did not complete successfully");
  } finally {
    try {
      const safeRoot = await assertOwnedPayloadRoot(root);
      await assertNoSymbolicLinks(safeRoot);
      await rm(safeRoot, { recursive: true, force: false });
      payload.cleanup = "removed";
    } catch (error) {
      payload.cleanup = "left-in-place";
      payload.cleanupError = error instanceof Error ? error.message : String(error);
    }
  }
}

function assertValidationRoot(root) {
  const expectedParent = path.resolve(tmpdir());
  const absolute = path.resolve(root);
  assert.equal(path.dirname(absolute).toLowerCase(), expectedParent.toLowerCase(), "Validation root must be a direct child of the system temp directory");
  assert(path.basename(absolute).startsWith("callme-installer-validation-"), "Unexpected validation root");
  return absolute;
}

function assertOwnedValidationPath(root, candidate, expectedName) {
  const checkedRoot = assertValidationRoot(root);
  const absolute = path.resolve(candidate);
  const relative = path.relative(checkedRoot, absolute);
  assert(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), "Validation path escapes its temp root");
  if (expectedName) assert.equal(path.basename(absolute), expectedName, "Unexpected validation file name");
  return absolute;
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function registryExists(registry) {
  try {
    await run("reg", ["query", registry], { windowsHide: true, timeout: 5_000, maxBuffer: 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitFor(predicate, timeout, description) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await pause(250);
  }
  assert.fail(`Timed out waiting for ${description}`);
}

async function waitForRemoval(install, registry, timeout) {
  await waitFor(async () => !(await exists(install)) && !(await registryExists(registry)), timeout, "the isolated installer to remove its install directory and registry key");
}

(async () => {
  const report = {
    status: "failed", installer: "", installerBytes: 0, unpacked: "", unpackedBytes: 0,
    isolated: { attempted: false, installed: false, uninstalled: false },
    payload: { attempted: false, stagedFiles: 0, stagedBytes: 0, extractedFiles: 0, extractedBytes: 0, cleanup: "not-needed" }
  };
  try {
    const pkg = JSON.parse(await readFile(path.join(project, "package.json"), "utf8"));
  assert.equal(pkg.version, "0.3.4");
  assert.equal(pkg.build?.nsis?.oneClick, false);
  assert.equal(pkg.build?.nsis?.perMachine, false);
  assert.equal(pkg.build?.nsis?.allowElevation, false);
  assert.equal(pkg.build?.nsis?.allowToChangeInstallationDirectory, true);
  assert.equal(pkg.build?.nsis?.runAfterFinish, false);
  assert.equal(pkg.build?.nsis?.deleteAppDataOnUninstall, false);
  assert.deepEqual(pkg.build?.nsis?.installerLanguages, ["ru_RU"]);
  assert.equal(pkg.build?.nsis?.language, "1049");
  assert.equal(pkg.build?.nsis?.differentialPackage, false);

  const entries = await readdir(output, { withFileTypes: true });
  const installers = entries.filter(entry => entry.isFile() && entry.name.endsWith(".exe")).map(entry => path.join(output, entry.name));
  assert.equal(installers.length, 1, "Expected exactly one NSIS installer in the isolated output directory");
  const installer = installers[0];
  const installerBytes = (await stat(installer)).size;
  assert(installerBytes > 10 * 1024 * 1024, "Installer is unexpectedly small");
  await access(path.join(unpacked, "LazyCall.exe"));

  const packaged = JSON.parse(require("@electron/asar").extractFile(path.join(unpacked, "resources", "app.asar"), "package.json").toString("utf8"));
  assert.equal(packaged.version, pkg.version, "Installer staging app must use the current package version");
  const whisper = path.join(unpacked, "resources", "whisper");
  const manifest = JSON.parse(await readFile(path.join(whisper, "manifest.json"), "utf8"));
  assert.equal(manifest.vcRuntime?.version, "14.51.36247.0", "Packaged Whisper runtime must record its pinned VC runtime provenance");
  assert.equal(manifest.vcRuntime?.sha256, "843068991daaa1f73ad9f6239bce4d0f6a07a51f18c37ea2a867e9beca71295c");
  const vcFiles = new Map((manifest.vcRuntime?.files || []).map(file => [file.name, file.sha256]));
  assert.equal(vcFiles.size, 4, "Packaged Whisper runtime must record all four VC DLL hashes");
  await Promise.all([
    access(path.join(whisper, manifest.model)), access(path.join(whisper, manifest.cpu)), access(path.join(whisper, manifest.cuda)),
    access(path.join(whisper, "LICENSE-whisper.cpp.txt")), access(path.join(whisper, "LICENSE-whisper-model.txt")), access(path.join(whisper, "LICENSE-NVIDIA-cuBLAS.txt")), access(path.join(whisper, "LICENSE-Microsoft-VC.txt"))
  ]);
  for (const backend of ["cpu", "cuda"]) {
    for (const [name, expected] of vcFiles) {
      const file = path.join(whisper, backend, "Release", name);
      await access(file);
      assert.equal(await sha256(file), expected, `Packaged ${backend} VC runtime hash mismatch: ${name}`);
    }
  }
  const runtimeFiles = await filesBelow(whisper);
  const allowed = new Set(["manifest.json", "ggml-large-v3-turbo-q5_0.bin", "LICENSE-whisper.cpp.txt", "LICENSE-whisper-model.txt", "LICENSE-NVIDIA-cuBLAS.txt", "LICENSE-Microsoft-VC.txt", manifest.cpu, manifest.cuda]);
  for (const file of runtimeFiles) {
    if (file.endsWith(".dll") && /^(cpu|cuda)\/Release\//.test(file)) continue;
    assert(allowed.has(file), `Unexpected Whisper resource: ${file}`);
  }
  assert(!runtimeFiles.some(file => /\.(zip|partial)$/i.test(file)), "Source archives must not be packaged");

  const unpackedBytes = await bytesBelow(unpacked);
  Object.assign(report, { installer, installerBytes, unpacked, unpackedBytes, version: pkg.version, whisperFiles: runtimeFiles.length });
  let isolated = null;
  if (process.env.CALLME_INSTALLER_ISOLATED === "1") {
    isolated = report.isolated;
    await smokeIsolatedInstaller(isolated);
  }
  if (process.env.CALLME_INSTALLER_PAYLOAD === "1") {
    await checkInstallerPayload(installer, unpacked, report.payload);
  }
  const checks = ["assisted per-user NSIS settings", "current staged app version", "offline Whisper CPU/CUDA and pinned VC runtime", "runtime licenses", "no archives or Whisper tools/tests"];
  if (report.payload.attempted) checks.push("installer payload file and SHA-256 parity with win-unpacked");
  Object.assign(report, { status: "passed", isolated: isolated || report.isolated, checks });
  console.log(JSON.stringify(report));
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

async function smokeIsolatedInstaller(validation) {
  const root = await mkdtemp(path.join(tmpdir(), "callme-installer-validation-"));
  assertValidationRoot(root);
  const nonce = randomUUID().replaceAll("-", "");
  const identity = `LazyCallInstallerValidation${nonce}`;
  const appId = `local.callme.installervalidation.${nonce}`;
  const guid = `{${randomUUID()}}`;
  const validationOutput = assertOwnedValidationPath(root, path.join(root, "package"));
  const install = assertOwnedValidationPath(root, path.join(root, "installed"));
  const registry = `HKCU\\Software\\${guid}`;
  assert.equal(registry, `HKCU\\Software\\${guid}`, "Validation registry identity must be the generated nonce GUID");
  const uninstaller = assertOwnedValidationPath(root, path.join(install, `Uninstall ${identity}.exe`), `Uninstall ${identity}.exe`);
  const builder = path.join(project, "node_modules", "electron-builder", "out", "cli", "cli.js");
  let installerInvoked = false;
  let primaryError;
  Object.assign(validation, { attempted: true, installed: false, uninstalled: false, identity, registry, cleanup: "not-needed" });
  try {
    await run(process.execPath, [builder, "--win", "nsis", "--x64",
      `--config.directories.output=${validationOutput}`, `--config.appId=${appId}`, `--config.productName=${identity}`,
      `--config.win.executableName=${identity}`, `--config.nsis.guid=${guid}`, `--config.nsis.shortcutName=${identity}`], {
      cwd: project, windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 600_000,
      env: { ...process.env, ELECTRON_BUILDER_COMPRESSION_LEVEL: "1" }
    });
    const generated = (await readdir(validationOutput, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith(".exe")).map(entry => path.join(validationOutput, entry.name));
    assert.equal(generated.length, 1, "Isolated validation must build exactly one installer");
    const installer = assertOwnedValidationPath(root, generated[0]);
    validation.installer = installer;
    installerInvoked = true;
    await run(installer, ["/currentuser", "/S", `/D=${install}`], { cwd: root, windowsHide: true, maxBuffer: 1024 * 1024, timeout: 180_000 });
    const executable = path.join(install, `${identity}.exe`);
    await waitFor(() => exists(executable), 60_000, "the isolated runtime executable");
    await access(path.join(install, "resources", "whisper", "manifest.json"));
    validation.installed = true;
    const tasklist = await run("tasklist", ["/FI", `IMAGENAME eq ${identity}.exe`, "/NH"], { windowsHide: true, timeout: 5_000, maxBuffer: 1024 * 1024 });
    assert(!tasklist.stdout.toLowerCase().includes(`${identity.toLowerCase()}.exe`), "Silent installer must not launch the validation app");
    assert(await registryExists(registry), "The isolated installer did not create its own registry identity");
    await waitFor(() => exists(uninstaller), 60_000, "the exact isolated uninstaller");
    await run(uninstaller, ["/S"], { cwd: root, windowsHide: true, maxBuffer: 1024 * 1024, timeout: 120_000 });
    await waitForRemoval(install, registry, 120_000);
    validation.uninstalled = true;
    validation.cleanup = "removed-by-own-uninstaller";
    validation.note = "Distinct appId, GUID, product/executable and shortcut identity; no production LazyCall installer was invoked.";
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    let cleanupError;
    try {
      if (installerInvoked && ((await exists(install)) || (await registryExists(registry)))) {
        await waitFor(() => exists(uninstaller), 60_000, "the exact isolated uninstaller");
        await run(uninstaller, ["/S"], { cwd: root, windowsHide: true, maxBuffer: 1024 * 1024, timeout: 120_000 });
        await waitForRemoval(install, registry, 120_000);
        validation.uninstalled = true;
        validation.cleanup = "removed-by-own-uninstaller";
      }
    } catch (error) {
      cleanupError = error;
      validation.cleanup = error instanceof Error ? error.message : String(error);
    }
    try {
      await rm(assertValidationRoot(root), { recursive: true, force: true });
    } catch (error) {
      cleanupError ??= error;
      validation.cleanup = error instanceof Error ? error.message : String(error);
    }
    if (cleanupError) {
      throw new AggregateError(primaryError ? [primaryError, cleanupError] : [cleanupError], "Isolated installer validation cleanup failed");
    }
  }
}
