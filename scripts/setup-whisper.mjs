import { mkdir, writeFile, stat, readdir, rename } from "node:fs/promises";
import { createWriteStream, createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(project, "runtime", "whisper");
if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Эта первая сборка — Windows x64");
await mkdir(root, { recursive: true });
const release = await (await fetch("https://api.github.com/repos/ggml-org/whisper.cpp/releases/tags/v1.9.2", {
  headers: { "User-Agent": "CallMe-setup" }, signal: AbortSignal.timeout(20000)
})).json();
const manifest = { release: "v1.9.2", cpu: "", cuda: "", model: "ggml-large-v3-turbo-q5_0.bin", files: [] };

async function hash(file, algorithm) {
  const h = createHash(algorithm);
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}
async function download(url, filename, expected, algorithm = "sha256") {
  const dest = path.join(root, filename);
  try {
    if ((await stat(dest)).size > 0 && (!expected || await hash(dest, algorithm) === expected)) return dest;
  } catch {}
  const tmp = dest + ".partial";
  console.log("Загрузка " + filename);
  const res = await fetch(url, { signal: AbortSignal.timeout(900000) });
  if (!res.ok || !res.body) throw new Error("Download " + res.status + ": " + filename);
  const total = Number(res.headers.get("content-length")) || 0;
  let bytes = 0, reported = 0;
  await pipeline(Readable.fromWeb(res.body), new Transform({
    transform(chunk, _, cb) {
      bytes += chunk.length;
      const pct = total ? Math.floor(bytes / total * 10) * 10 : Math.floor(bytes / 50000000) * 50;
      if (pct > reported) { reported = pct; console.log(filename + ": " + (total ? pct + "%" : Math.round(bytes / 1048576) + " MiB")); }
      cb(null, chunk);
    }
  }), createWriteStream(tmp));
  const actual = await hash(tmp, algorithm);
  if (expected && actual !== expected) throw new Error("Checksum mismatch: " + filename);
  await rename(tmp, dest);
  return dest;
}
async function findExe(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) { const found = await findExe(name); if (found) return found; }
    else if (entry.name === "whisper-server.exe" || entry.name === "server.exe") return name;
  }
}
for (const [backend, assetName] of [
  ["cpu", "whisper-bin-x64.zip"],
  ["cuda", "whisper-cublas-11.8.0-bin-x64.zip"]
]) {
  const asset = release.assets?.find(a => a.name === assetName);
  if (!asset) throw new Error("Нет официального runtime asset: " + assetName);
  const expected = asset.digest?.startsWith("sha256:") ? asset.digest.slice(7) : undefined;
  const archive = await download(asset.browser_download_url, assetName, expected);
  const output = path.join(root, backend);
  await mkdir(output, { recursive: true });
  let exe = await findExe(output);
  if (!exe) {
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "Expand-Archive -LiteralPath $env:CALLME_ARCHIVE -DestinationPath $env:CALLME_OUTPUT -Force"], {
      windowsHide: true, env: { ...process.env, CALLME_ARCHIVE: archive, CALLME_OUTPUT: output }, stdio: "inherit"
    });
    exe = await findExe(output);
  }
  if (!exe) throw new Error("В архиве нет whisper-server.exe");
  manifest[backend] = path.relative(root, exe).replaceAll("\\", "/");
  manifest.files.push({ name: assetName, sha256: await hash(archive, "sha256"), origin: asset.browser_download_url });
}
// The upstream CUDA archive includes cudart, but not the cuBLAS runtime DLLs.
// Take only the redistributable DLLs and license from NVIDIA's pinned package.
const cublasName = "libcublas-windows-x86_64-11.11.3.6-archive.zip";
const cublasOrigin = "https://developer.download.nvidia.com/compute/cuda/redist/libcublas/windows-x86_64/" + cublasName;
const cublasSha = "67b0934a6359e4ee26fff823c356021589d392c4fd49ca12624f570edc08e2b9";
const cublasArchive = await download(cublasOrigin, cublasName, cublasSha);
const cudaDirectory = path.dirname(path.join(root, manifest.cuda));
execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($env:CALLME_ARCHIVE)
try {
  foreach ($name in @('cublas64_11.dll', 'cublasLt64_11.dll', 'LICENSE')) {
    $entry = $archive.Entries | Where-Object { $_.Name -eq $name } | Select-Object -First 1
    if (-not $entry) { throw "Missing cuBLAS entry: $name" }
    $target = if ($name -eq 'LICENSE') { Join-Path $env:CALLME_LICENSES 'LICENSE-NVIDIA-cuBLAS.txt' } else { Join-Path $env:CALLME_OUTPUT $name }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
  }
} finally { $archive.Dispose() }
`], { windowsHide: true, env: { ...process.env, CALLME_ARCHIVE: cublasArchive, CALLME_OUTPUT: cudaDirectory, CALLME_LICENSES: root }, stdio: "inherit" });
manifest.files.push({ name: cublasName, sha256: cublasSha, origin: cublasOrigin });
const model = await download(
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
  manifest.model, "e050f7970618a659205450ad97eb95a18d69c9ee", "sha1"
);
manifest.files.push({ name: manifest.model, sha256: await hash(model, "sha256") });
await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
for (const [name, url] of [
  ["LICENSE-whisper.cpp.txt", "https://raw.githubusercontent.com/ggml-org/whisper.cpp/v1.9.2/LICENSE"],
  ["LICENSE-whisper-model.txt", "https://raw.githubusercontent.com/openai/whisper/main/LICENSE"]
]) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error("License download failed: " + name);
  await writeFile(path.join(root, name), await response.text());
}
console.log("Whisper готов: CPU + CUDA, модель проверена по опубликованному SHA1; SHA256 записаны в manifest.");
