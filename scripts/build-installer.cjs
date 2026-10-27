const { cp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const path = require("node:path");
const assert = require("node:assert/strict");
const { getPath7za } = require("app-builder-lib/out/toolsets/7zip");
const { compute7zCompressArgs } = require("app-builder-lib/out/targets/archive");
const asar = require("@electron/asar");

const project = path.resolve(__dirname, "..");
const output = path.resolve(project, "release", "compact-offline");
const unpacked = path.join(output, "win-unpacked");
if (path.relative(project, output).replaceAll("\\", "/") !== "release/compact-offline") throw new Error("Unexpected installer output path");

async function run(executable, args, options = {}) {
  const child = spawn(executable, args, { cwd: project, stdio: "inherit", windowsHide: true, ...options });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", value => resolve(value ?? 1)); });
  if (code !== 0) throw new Error(`${path.basename(executable)} failed with exit code ${code}`);
}
async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function manifest(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      if (entry.isSymbolicLink()) throw new Error("Release staging must not contain links");
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) files.push({ path: path.relative(root, file).replaceAll("\\", "/"), bytes: (await stat(file)).size, sha256: await sha256(file) });
      else throw new Error("Unsupported release staging entry");
    }
  }
  await walk(root);
  return files;
}

(async () => {
  const pkg = JSON.parse(await readFile(path.join(project, "package.json"), "utf8"));
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--prepackaged")) throw new Error("Usage: build-installer.cjs [--prepackaged <existing win-unpacked>]");
  let source, sourceManifest;
  if (args.length) {
    source = await realpath(path.resolve(project, args[1]));
    const release = path.join(project, "release") + path.sep;
    if (!source.toLowerCase().startsWith(release.toLowerCase()) || source.toLowerCase().startsWith(output.toLowerCase() + path.sep) || source.toLowerCase() === output.toLowerCase()) throw new Error("Prepackaged input must be a separate release directory");
    const packaged = JSON.parse(asar.extractFile(path.join(source, "resources", "app.asar"), "package.json"));
    assert.equal(packaged.name, pkg.name); assert.equal(packaged.version, pkg.version, "Prepackaged app must match current source version");
    sourceManifest = await manifest(source);
  }
  // Cleanup is confined to this exact, dedicated release output.
  const resolvedProject = await realpath(project);
  await mkdir(path.join(project, "release"), { recursive: true });
  const resolvedRelease = await realpath(path.join(project, "release"));
  assert.equal(resolvedRelease.toLowerCase(), path.join(resolvedProject, "release").toLowerCase(), "Release output must not redirect outside the workspace");
  try {
    assert.equal((await realpath(output)).toLowerCase(), path.join(resolvedRelease, "compact-offline").toLowerCase(), "Installer output must not be a redirected directory");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const cli = path.join(project, "node_modules", "electron-builder", "out", "cli", "cli.js");
  if (source) await cp(source, unpacked, { recursive: true, errorOnExist: true, force: false });
  else await run(process.execPath, [cli, "--win", "dir", "--x64", `--config.directories.output=${output}`]);
  const before = await manifest(unpacked);
  if (sourceManifest) assert.deepEqual(before, sourceManifest, "Repacking must preserve every original file");

  // Bound both the dictionary and workers: auto-selected encoders previously
  // ran out of memory on this host at higher compression levels.
  const level = "7", dictionaryMiB = 32, threads = 4;
  process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL = level;
  const tool = await getPath7za();
  const archive = path.join(output, `${pkg.name}-${pkg.version}-x64.nsis.7z`);
  const compress = compute7zCompressArgs("7z", { compression: "maximum", installTimeDecodable: true, dictSize: dictionaryMiB });
  compress.push(`-mmt=${threads}`, "-bsp0", archive, ".");
  console.log(`Compressing full offline payload: level ${level}, ${dictionaryMiB} MiB dictionary, ${threads} threads`);
  const started = Date.now();
  const ticker = setInterval(() => console.log(`Offline payload compression: ${Math.floor((Date.now() - started) / 1000)}s elapsed`), 30_000);
  try { await run(tool, compress, { cwd: unpacked }); }
  finally { clearInterval(ticker); }
  await run(tool, ["t", "-bd", archive]);
  assert.deepEqual(await manifest(unpacked), before, "Staging changed during compression");
  const compressedBytes = (await stat(archive)).size;
  const archiveHash = await sha256(archive);

  // Standard NSIS packaging reuses this fresh payload. Elevation is disabled;
  // prevent a redundant helper update from recompressing the solid archive.
  assert.equal(pkg.build.nsis.perMachine, false);
  assert.equal(pkg.build.nsis.allowElevation, false);
  await run(process.execPath, [cli, "--win", "nsis", "--x64", `--config.directories.output=${output}`, `--prepackaged=${unpacked}`, "--config.nsis.packElevateHelper=false"]);
  assert.deepEqual(await manifest(unpacked), before, "NSIS packaging must preserve staging bytes");
  const report = { version: pkg.version, source: source || "fresh build", compression: { level: Number(level), dictionaryMiB, threads, elapsedMs: Date.now() - started, bytes: compressedBytes, sha256: archiveHash }, files: before };
  await writeFile(path.join(output, "payload-manifest.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: "built", version: pkg.version, files: before.length, payloadBytes: compressedBytes, compressionSeconds: Math.round((Date.now() - started) / 1000) }));
})().catch(error => { console.error(error); process.exitCode = 1; });
