const { copyFile, mkdir, readFile, realpath, rm, stat, writeFile, readdir } = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const path = require("node:path");
const assert = require("node:assert/strict");
const asar = require("@electron/asar");
const { getPath7za } = require("app-builder-lib/out/toolsets/7zip");
const { getNsisPluginsPath } = require("app-builder-lib/out/toolsets/windows");
const { compute7zCompressArgs } = require("app-builder-lib/out/targets/archive");

const project = path.resolve(__dirname, "..");
const releaseRoot = path.join(project, "release");
const buildResources = path.join(project, "build");
const payloadCacheRoot = path.join(releaseRoot, "web-payload-cache");
const previewPort = 38473;

async function run(executable, args, options = {}) {
  const child = spawn(executable, args, { cwd: project, stdio: "inherit", windowsHide: true, ...options });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", value => resolve(value ?? 1)); });
  if (code !== 0) throw new Error(`${path.basename(executable)} failed with exit code ${code}`);
}

async function hash(file, algorithm) {
  const digest = createHash(algorithm);
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}

async function runCapture(executable, args, options = {}) {
  const child = spawn(executable, args, { cwd: project, windowsHide: true, ...options, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", value => { stdout += value; });
  child.stderr.on("data", value => { stderr += value; });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", value => resolve(value ?? 1)); });
  if (code !== 0) throw new Error(path.basename(executable) + " failed with exit code " + code + ": " + stderr.trim());
  return stdout.trim();
}

function requireRepository(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value || "")) {
    throw new Error("Set CALLME_RELEASE_REPOSITORY to an owner/repository GitHub Releases destination");
  }
  return value;
}

function releaseChannel(version) {
  const prerelease = /^\d+\.\d+\.\d+-([0-9A-Za-z]+)(?:[.-].*)?$/.exec(version);
  return prerelease ? prerelease[1] : "latest";
}

async function assertGithubReleaseFeed(stage, repository) {
  const [owner, repo] = repository.split("/");
  const feed = await readFile(path.join(stage.source, "resources", "app-update.yml"), "utf8");
  const expected = new Map([
    ["provider", "github"],
    ["owner", owner],
    ["repo", repo],
    ["updaterCacheDirName", "callme-updater"],
  ]);
  const received = new Map();
  for (const line of feed.split(/\r?\n/).filter(line => line.trim())) {
    const match = /^([A-Za-z]+): ([A-Za-z0-9_.-]+)$/.exec(line);
    if (!match || received.has(match[1])) throw new Error("Staged app-update.yml is not the generated GitHub update schema");
    received.set(match[1], match[2]);
  }
  if (received.size !== expected.size || [...expected].some(([key, value]) => received.get(key) !== value)) {
    throw new Error("Staged app-update.yml does not match CALLME_RELEASE_REPOSITORY");
  }
}

function parseArguments(values) {
  let localPreview = false, fullInstaller = false, reviewDownloadOnly = false, prepackaged;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--local-preview") localPreview = true;
    else if (value === "--full-installer") fullInstaller = true;
    else if (value === "--review-download-only") reviewDownloadOnly = true;
    else if (value === "--prepackaged" && !prepackaged && values[index + 1]) prepackaged = values[++index];
    else throw new Error("Usage: CALLME_RELEASE_REPOSITORY=owner/repo node scripts/build-web-installer.cjs --prepackaged <win-unpacked> [--local-preview] [--full-installer] [--review-download-only]");
  }
  if (!prepackaged) throw new Error("A fresh light --prepackaged win-unpacked directory is required");
  if (reviewDownloadOnly && !localPreview) throw new Error("--review-download-only is restricted to --local-preview");
  return { localPreview, fullInstaller, reviewDownloadOnly, prepackaged };
}

async function assertPreviewBootstrappersClosed(output) {
  let entries;
  try { entries = await readdir(path.join(output, "nsis-web"), { withFileTypes: true }); }
  catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  const candidates = entries.filter(entry => entry.isFile() && /^LazyCallWebPreview Web Setup .+\.exe$/i.test(entry.name))
    .map(entry => path.join(output, "nsis-web", entry.name));
  for (const executable of candidates) {
    const result = await runCapture("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      "$p=[Environment]::GetEnvironmentVariable('CALLME_WEB_PREVIEW_EXE'); @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $p } | ForEach-Object { $_.ProcessId }) -join ','",
    ], { env: { ...process.env, CALLME_WEB_PREVIEW_EXE: executable } });
    if (result) throw new Error("Close the running review preview before rebuilding: " + executable + " (PID " + result + ")");
  }
}

async function ensureOwnedOutput(output, expectedRelative, localPreview) {
  await mkdir(releaseRoot, { recursive: true });
  const resolvedProject = await realpath(project);
  const resolvedRelease = await realpath(releaseRoot);
  assert.equal(resolvedRelease.toLowerCase(), path.join(resolvedProject, "release").toLowerCase(), "Release directory must stay in the workspace");
  assert.equal(path.relative(project, output).replaceAll("\\", "/"), expectedRelative, "Unexpected web installer output path");
  try {
    assert.equal((await realpath(output)).toLowerCase(), path.join(resolvedRelease, path.basename(output)).toLowerCase(), "Web installer output must not redirect outside the workspace");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (localPreview) await assertPreviewBootstrappersClosed(output);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
}

function nsisString(value) {
  if (/[\r\n\0]/.test(value)) throw new Error("NSIS definition contains a line break or NUL");
  return value.replaceAll("$", "$$").replaceAll('"', '$\\"');
}
function mib(bytes) { return (bytes / (1024 * 1024)).toFixed(1); }

async function createBuildInputs(vcRuntime, packageInfo) {
  if (!/^https:\/\/download\.visualstudio\.microsoft\.com\//.test(vcRuntime.origin || "")) throw new Error("VC runtime origin must be the official Microsoft HTTPS origin");
  if (!/^[a-f0-9]{64}$/i.test(vcRuntime.sha256 || "")) throw new Error("VC runtime requires a pinned SHA-256");
  if (!Number.isSafeInteger(vcRuntime.bytes) || vcRuntime.bytes <= 0) throw new Error("VC runtime requires a byte size");
  if (vcRuntime.version !== "14.51.36247.0") throw new Error("Unexpected VC runtime version");
  const definitions = [
    `!define CALLME_VC_URL "${nsisString(vcRuntime.origin)}"`,
    `!define CALLME_VC_SHA256 "${vcRuntime.sha256.toUpperCase()}"`,
    `!define CALLME_VC_BYTES "${vcRuntime.bytes}"`,
    `!define CALLME_VC_VERSION "${nsisString(vcRuntime.version)}"`,
    `!define CALLME_PACKAGE_MIB "${mib(packageInfo.bytes)}"`,
    `!define CALLME_INSTALLED_MIB "${mib(packageInfo.unpackedBytes)}"`,
    `!define CALLME_REVIEW_DOWNLOAD_ONLY "${packageInfo.reviewDownloadOnly ? "true" : "false"}"`,
    "",
  ].join("\n");
  const vcInclude = path.join(buildResources, "callme-web-installer-vc.nsh");
  await writeFile(vcInclude, definitions, "utf8");

  const plugins = await getNsisPluginsPath(undefined, undefined);
  const sourcePlugin = path.join(plugins, "x86-unicode", "INetC.dll");
  await stat(sourcePlugin);
  const userPluginDir = path.join(buildResources, "x86-unicode");
  const targetPlugin = path.join(userPluginDir, "inetc.dll");
  await mkdir(userPluginDir, { recursive: true });
  let pluginCreated = false;
  try {
    await stat(targetPlugin);
    assert.equal(await hash(targetPlugin, "sha256"), await hash(sourcePlugin, "sha256"), "Existing build/x86-unicode/inetc.dll is not the expected bundled plugin");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await copyFile(sourcePlugin, targetPlugin, 0);
    pluginCreated = true;
  }
  return { vcInclude, targetPlugin, pluginCreated };
}

async function readStage(input) {
  const source = await realpath(path.resolve(project, input));
  const releasePrefix = `${await realpath(releaseRoot)}${path.sep}`.toLowerCase();
  if (!source.toLowerCase().startsWith(releasePrefix)) throw new Error("Prepackaged input must be beneath release/");
  const asarPath = path.join(source, "resources", "app.asar");
  await stat(asarPath);
  const packaged = JSON.parse(asar.extractFile(asarPath, "package.json"));
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(packaged.name || "") || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(packaged.version || "")) throw new Error("Invalid staged app name or version");
  try {
    await stat(path.join(source, "resources", "codex"));
    throw new Error("Public web staging must not bundle resources/codex");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const prohibitedRuntimeDlls = new Set(["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll", "vcomp140.dll"]);
  let unpackedBytes = 0;
  const stageDigest = createHash("sha256");
  async function walk(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Prepackaged input must not contain symbolic links");
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) {
        if (prohibitedRuntimeDlls.has(entry.name.toLowerCase())) throw new Error("Public web staging must not bundle " + entry.name);
        const before = await stat(file);
        const fileHash = await hash(file, "sha256");
        const after = await stat(file);
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("Prepackaged input changed while its cache key was calculated");
        unpackedBytes += before.size;
        stageDigest.update(path.relative(source, file).replaceAll("\\", "/"));
        stageDigest.update("\0");
        stageDigest.update(String(before.size));
        stageDigest.update("\0");
        stageDigest.update(fileHash);
        stageDigest.update("\0");
      }
      else throw new Error("Unsupported prepackaged entry");
    }
  }
  await walk(source);
  return { source, name: packaged.name, version: packaged.version, unpackedBytes, digest: stageDigest.digest("hex") };
}

async function createPayload(stage, destination, payloadName) {
  const cacheDirectory = path.join(payloadCacheRoot, stage.digest);
  const cachePayload = path.join(cacheDirectory, payloadName);
  const cacheManifest = path.join(cacheDirectory, "payload-manifest.json");
  await mkdir(cacheDirectory, { recursive: true });
  try {
    const cached = JSON.parse(await readFile(cacheManifest, "utf8"));
    if (cached.stageDigest === stage.digest && cached.name === payloadName && (await stat(cachePayload)).size === cached.bytes && await hash(cachePayload, "sha256") === cached.sha256) {
      await copyFile(cachePayload, destination);
      console.log("Reusing verified payload cache for unchanged staged application");
      return { bytes: cached.bytes, sha256: cached.sha256, sha512: cached.sha512, cached: true };
    }
  } catch (error) {
    if (error.code !== "ENOENT" && error.name !== "SyntaxError") throw error;
  }
  await rm(cachePayload, { force: true });
  const tool = await getPath7za();
  const compress = compute7zCompressArgs("7z", { compression: "maximum", installTimeDecodable: true, dictSize: 32 });
  const compressionIndex = compress.indexOf("-mx=9");
  assert.notEqual(compressionIndex, -1, "Unexpected electron-builder 7z compression arguments");
  compress[compressionIndex] = "-mx=7";
  compress.push("-mmt=4", "-bsp0", cachePayload, ".");
  console.log("Compressing public web payload: level 7, 32 MiB dictionary, 4 threads");
  await run(tool, compress, { cwd: stage.source });
  await run(tool, ["t", "-bd", cachePayload]);
  const payload = { bytes: (await stat(cachePayload)).size, sha256: await hash(cachePayload, "sha256"), sha512: await hash(cachePayload, "sha512"), cached: false };
  await writeFile(cacheManifest, JSON.stringify({ stageDigest: stage.digest, name: payloadName, ...payload }, null, 2));
  await copyFile(cachePayload, destination);
  return payload;
}

(async () => {
  const options = parseArguments(process.argv.slice(2));
  const packageJson = JSON.parse(await readFile(path.join(project, "package.json"), "utf8"));
  const stage = await readStage(options.prepackaged);
  assert.equal(stage.name, packageJson.name, "Prepackaged app must match package.json name");
  assert.equal(stage.version, packageJson.version, "Prepackaged app must match package.json version");
  const vcRuntime = JSON.parse(await readFile(path.join(project, "runtime", "whisper", "manifest.json"), "utf8")).vcRuntime;
  const releaseRepository = options.localPreview ? null : requireRepository(process.env.CALLME_RELEASE_REPOSITORY);
  if (!options.localPreview) await assertGithubReleaseFeed(stage, releaseRepository);
  const payloadName = `${stage.name}-${stage.version}-x64.nsis.7z`;
  const downloadUrl = options.localPreview
    ? `http://127.0.0.1:${previewPort}/${payloadName}`
    : `https://github.com/${releaseRepository}/releases/download/v${stage.version}/${payloadName}`;
  if (options.localPreview && !/^http:\/\/127\.0\.0\.1:38473\/[A-Za-z0-9_.-]+$/.test(downloadUrl)) throw new Error("Preview downloads must use the fixed loopback endpoint");

  const output = path.join(releaseRoot, options.localPreview ? "lazycall-web-preview" : "web-installer");
  await ensureOwnedOutput(output, options.localPreview ? "release/lazycall-web-preview" : "release/web-installer", options.localPreview);
  const targetOutput = path.join(output, "nsis-web");
  await mkdir(targetOutput, { recursive: true });
  const payload = path.join(targetOutput, payloadName);
  const payloadInfo = await createPayload(stage, payload, payloadName);
  const inputs = await createBuildInputs(vcRuntime, { ...payloadInfo, unpackedBytes: stage.unpackedBytes, reviewDownloadOnly: options.reviewDownloadOnly });
  const cli = path.join(project, "node_modules", "electron-builder", "out", "cli", "cli.js");
  const config = [
    "--win", "nsis-web", "--x64", `--prepackaged=${stage.source}`,
    `--config.directories.output=${output}`,
    "--config.nsisWeb.include=web-installer.nsh",
    `--config.nsisWeb.appPackageUrl=${downloadUrl}`,
    "--config.nsisWeb.differentialPackage=false",
    "--config.nsisWeb.packElevateHelper=false",
  ];
  const identity = options.localPreview ? [
    "--config.appId=local.lazycall.webpreview", "--config.productName=LazyCallWebPreview", "--config.executableName=LazyCallWebPreview",
    "--config.nsis.guid=1A7EC2C7-7782-4A99-AB1B-1D530BB80AFE", "--config.nsis.shortcutName=LazyCallWebPreview",
  ] : [];
  let fullInstaller;
  try {
    await run(process.execPath, [cli, ...config, ...identity, "--publish", "never"]);
    if (options.fullInstaller) {
      const fullArchive = path.join(output, payloadName);
      await copyFile(payload, fullArchive);
      const fullConfig = [
        "--win", "nsis", "--x64", "--prepackaged=" + stage.source,
        "--config.directories.output=" + output,
        "--config.nsis.include=web-installer.nsh",
        "--config.nsis.packElevateHelper=false",
      ];
      if (!options.localPreview) {
        const [owner, repo] = releaseRepository.split("/");
        fullConfig.push(
          "--config.publish.provider=github",
          "--config.publish.owner=" + owner,
          "--config.publish.repo=" + repo,
          "--config.publish.releaseType=prerelease",
          "--config.publish.channel=" + releaseChannel(stage.version),
        );
      }
      await run(process.execPath, [cli, ...fullConfig, ...identity, "--publish", "never"]);
      fullInstaller = path.join(output, "nsis", (options.localPreview ? "LazyCallWebPreview" : "LazyCall") + " Setup " + stage.version + ".exe");
      await stat(fullInstaller);
    }
  } finally {
    await rm(inputs.vcInclude, { force: true });
    if (inputs.pluginCreated) await rm(inputs.targetPlugin, { force: true });
  }
  const installer = path.join(targetOutput, `${options.localPreview ? "LazyCallWebPreview" : "LazyCall"} Web Setup ${stage.version}.exe`);
  await stat(installer);
  let checksumsManifest;
  if (fullInstaller && !options.localPreview) {
    const channel = releaseChannel(stage.version);
    const updateMetadata = path.join(output, channel + ".yml");
    await stat(updateMetadata);
    const files = [
      ["webInstaller", installer],
      ["payload", payload],
      ["fullInstaller", fullInstaller],
      ["updateMetadata", updateMetadata],
    ];
    checksumsManifest = {
      version: stage.version,
      releaseRepository,
      channel,
      published: false,
      files: Object.fromEntries(await Promise.all(files.map(async ([name, file]) => [
        name,
        { path: path.relative(project, file).replaceAll("\\", "/"), bytes: (await stat(file)).size, sha256: await hash(file, "sha256") },
      ]))),
    };
    await writeFile(path.join(output, "checksums.json"), JSON.stringify(checksumsManifest, null, 2));
  }
  const report = {
    version: stage.version, mode: options.localPreview ? "local-preview" : "github-release",
    output: path.relative(project, output).replaceAll("\\", "/"), installer: path.relative(project, installer).replaceAll("\\", "/"), downloadUrl,
    payload: { name: payloadName, bytes: payloadInfo.bytes, sha256: payloadInfo.sha256, sha512: payloadInfo.sha512, cached: payloadInfo.cached, stageDigest: stage.digest },
    ...(fullInstaller ? { fullInstaller: { path: path.relative(project, fullInstaller).replaceAll("\\", "/"), bytes: (await stat(fullInstaller)).size } } : {}),
    ...(checksumsManifest ? { checksums: "release/web-installer/checksums.json" } : {}),
    vcRuntime: { version: vcRuntime.version, bytes: vcRuntime.bytes, sha256: vcRuntime.sha256, origin: vcRuntime.origin },
    identity: options.localPreview
      ? { appId: "local.lazycall.webpreview", guid: "1A7EC2C7-7782-4A99-AB1B-1D530BB80AFE", productName: "LazyCallWebPreview", executableName: "LazyCallWebPreview", shortcutName: "LazyCallWebPreview" }
      : { appId: packageJson.build.appId, productName: packageJson.build.productName, executableName: "LazyCall", shortcutName: "LazyCall" },
  };
  await writeFile(path.join(output, "web-installer-manifest.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: "built", ...report }));
})().catch(error => { console.error(error); process.exitCode = 1; });
