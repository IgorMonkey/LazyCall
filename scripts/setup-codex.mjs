import { mkdir, readFile, writeFile, stat, rename } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = "0.145.0-win32-x64";
const root = path.join(project, "runtime", "codex");
if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Нужна Windows x64");
await mkdir(root, { recursive: true });
const response = await fetch("https://registry.npmjs.org/@openai/codex/" + version, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error("Не удалось получить Codex runtime");
const metadata = await response.json();
const archive = path.join(project, "runtime", "openai-codex-" + version + ".tgz");
const digest = async filename => { const hash = createHash("sha512"); for await (const chunk of createReadStream(filename)) hash.update(chunk); return "sha512-" + hash.digest("base64"); };
let cached = false;
try { cached = (await stat(archive)).size > 0 && await digest(archive) === metadata.dist.integrity; } catch {}
if (!cached) {
  console.log("Загрузка Codex " + version);
  const download = await fetch(metadata.dist.tarball, { signal: AbortSignal.timeout(900000) });
  if (!download.ok || !download.body) throw new Error("Не удалось скачать Codex");
  await pipeline(Readable.fromWeb(download.body), createWriteStream(archive + ".partial"));
  if (await digest(archive + ".partial") !== metadata.dist.integrity) throw new Error("Контрольная сумма Codex не совпала");
  await rename(archive + ".partial", archive);
}
execFileSync("tar.exe", ["-xzf", archive, "-C", root], { windowsHide: true, stdio: "inherit" });
const executable = "package/vendor/x86_64-pc-windows-msvc/bin/codex.exe";
await stat(path.join(root, executable));
const license = await fetch("https://raw.githubusercontent.com/openai/codex/rust-v0.145.0/LICENSE", { signal: AbortSignal.timeout(20000) });
if (!license.ok) throw new Error("Не удалось скачать лицензию Codex");
await writeFile(path.join(root, "LICENSE-Codex.txt"), await license.text());
const notice = await fetch("https://raw.githubusercontent.com/openai/codex/rust-v0.145.0/NOTICE", { signal: AbortSignal.timeout(20000) });
if (!notice.ok) throw new Error("Не удалось скачать NOTICE Codex");
await writeFile(path.join(root, "NOTICE-Codex.txt"), await notice.text());
await writeFile(path.join(root, "manifest.json"), JSON.stringify({ version: "0.145.0", executable, origin: metadata.dist.tarball, integrity: metadata.dist.integrity }, null, 2) + "\n");
console.log("Codex runtime готов. Вход выполняется отдельно в CallMe.");
