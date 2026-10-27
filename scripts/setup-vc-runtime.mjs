import { access, copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getPath7za } = require("app-builder-lib/out/toolsets/7zip");
const exec = promisify(execFile);
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const whisper = path.join(project, "runtime", "whisper");
const source = path.join(project, "runtime", "vc-redist", "vc_redist.x64.exe");
const sevenZip = await getPath7za();
const manifestPath = path.join(whisper, "manifest.json");
const licensePath = path.join(whisper, "LICENSE-Microsoft-VC.txt");

const REDIST = {
  origin: "https://download.visualstudio.microsoft.com/download/pr/ebdab8e5-1d7b-4d9f-a11b-cbb1720c3b12/843068991DAAA1F73AD9F6239BCE4D0F6A07A51F18C37EA2A867E9BECA71295C/VC_redist.x64.exe",
  discoveryUrl: "https://aka.ms/vc14/vc_redist.x64.exe",
  version: "14.51.36247.0",
  sha256: "843068991daaa1f73ad9f6239bce4d0f6a07a51f18c37ea2a867e9beca71295c",
  bytes: 18_731_856,
  payloadOffset: 630_000,
  payloadBytes: 18_091_661,
  payloadSha256: "8b1595b5d0001e0747371ecfc2dccb604dc836fba0a778566e97a6bdb0816bb8",
  minimumCab: { name: "a4", bytes: 1_065_893, sha256: "6e8ee73933678c55973e83366e48e948b394c7a36743a36b7224c95de979b13f" },
  license: "https://visualstudio.microsoft.com/wp-content/uploads/2025/10/Visual-C-V14-License-Redistributable_and_Runtime_ENU.docx"
};

const dlls = {
  "MSVCP140.dll": { archiveName: "msvcp140.dll_amd64", sha256: "7c26614e1d733892c2deac7e245ce115504b1d80592dd0a01b08e3e5a55f89ca" },
  "VCRUNTIME140.dll": { archiveName: "vcruntime140.dll_amd64", sha256: "d1f4225df2cd877dbf130d5668a021dce3f94118455ff5ec952061c30afc9ce7" },
  "VCRUNTIME140_1.dll": { archiveName: "vcruntime140_1.dll_amd64", sha256: "a7146c08f89fe5b04541ab507cdb59ff7b44534d4ba3c668a426c6450a03434e" },
  "VCOMP140.dll": { archiveName: "vcomp140.dll_amd64", sha256: "95d4ce4a6802d1e18b5e0e1722cc30ea72ca7e033f83828f05c0b7b993fe7cbf" }
};

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function downloadPinned() {
  await mkdir(path.dirname(source), { recursive: true });
  try {
    if ((await stat(source)).size === REDIST.bytes && await sha256(source) === REDIST.sha256) return;
  } catch {}
  const partial = source + ".partial";
  const response = await fetch(REDIST.origin, { signal: AbortSignal.timeout(900_000) });
  if (!response.ok) throw new Error(`VC runtime download failed: ${response.status}`);
  await writeFile(partial, Buffer.from(await response.arrayBuffer()));
  if ((await sha256(partial)) !== REDIST.sha256) throw new Error("VC runtime SHA-256 mismatch");
  await rename(partial, source);
}

async function assertMicrosoftSignature(file) {
  const command = "$env:PSModulePath=[Environment]::GetEnvironmentVariable('PSModulePath','Machine')+';'+[Environment]::GetEnvironmentVariable('PSModulePath','User'); Import-Module Microsoft.PowerShell.Security; $s=Get-AuthenticodeSignature -LiteralPath $env:CALLME_SIGNED_FILE; [pscustomobject]@{status=$s.Status.ToString();subject=$s.SignerCertificate.Subject}|ConvertTo-Json -Compress";
  const powershell = path.join(process.env.WINDIR || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const { stdout } = await exec(powershell, ["-NoProfile", "-NonInteractive", "-Command", command], {
    windowsHide: true, timeout: 30_000, env: { ...process.env, CALLME_SIGNED_FILE: file }
  });
  const signature = JSON.parse(stdout);
  if (signature.status !== "Valid" || !/Microsoft Corporation/i.test(signature.subject || "")) throw new Error(`Expected a valid Microsoft signature: ${file}`);
}

async function assertX64Pe(file) {
  const data = await readFile(file);
  if (data.subarray(0, 2).toString("ascii") !== "MZ") throw new Error(`Not a PE file: ${file}`);
  const pe = data.readUInt32LE(0x3c);
  if (data.subarray(pe, pe + 4).toString("ascii") !== "PE\0\0" || data.readUInt16LE(pe + 4) !== 0x8664 || data.readUInt16LE(pe + 24) !== 0x20b) throw new Error(`Expected an x64 PE file: ${file}`);
}

async function run7z(args) {
  try {
    await exec(sevenZip, args, { windowsHide: true, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  } catch (error) {
    // 7-Zip reports exit code 1 for the known CAB trailing-data warning.
    if (error.code !== 1) throw error;
  }
}

function documentText(xml) {
  const decode = value => value.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", "\"").replaceAll("&apos;", "'");
  return [...xml.matchAll(/<w:p(?: [^>]*)?>([\s\S]*?)<\/w:p>/g)]
    .map(match => decode(match[1].replace(/<w:tab\/?>(?:<\/w:tab>)?/g, "\t").replace(/<w:br\/?>(?:<\/w:br>)?/g, "\n").replace(/<[^>]+>/g, "").trim()))
    .filter(Boolean).join("\n\n");
}

function assertTempRoot(directory) {
  const root = path.resolve(directory);
  const parent = path.resolve(tmpdir());
  if (path.dirname(root).toLowerCase() !== parent.toLowerCase() || !path.basename(root).startsWith("callme-vc-runtime-")) throw new Error("Refusing to remove an unexpected staging directory");
  return root;
}

await downloadPinned();
await assertMicrosoftSignature(source);
if ((await sha256(source)) !== REDIST.sha256) throw new Error("Pinned VC redistributable changed");
await access(sevenZip);

const temp = await mkdtemp(path.join(tmpdir(), "callme-vc-runtime-"));
try {
  const executable = await readFile(source);
  const payload = executable.subarray(REDIST.payloadOffset, REDIST.payloadOffset + REDIST.payloadBytes);
  if (payload.subarray(0, 4).toString("ascii") !== "MSCF" || createHash("sha256").update(payload).digest("hex") !== REDIST.payloadSha256) throw new Error("Pinned VC payload container did not match");
  const payloadPath = path.join(temp, "payload.cab");
  await writeFile(payloadPath, payload);
  const payloadDir = path.join(temp, "payload");
  await run7z(["x", payloadPath, `-o${payloadDir}`, "-y"]);
  const minimumCab = path.join(payloadDir, REDIST.minimumCab.name);
  if ((await stat(minimumCab)).size !== REDIST.minimumCab.bytes || await sha256(minimumCab) !== REDIST.minimumCab.sha256) throw new Error("Pinned VC minimum CAB did not match");
  const extracted = path.join(temp, "minimum");
  await run7z(["e", minimumCab, `-o${extracted}`, "-y", ...Object.values(dlls).map(file => file.archiveName)]);

  for (const [name, expected] of Object.entries(dlls)) {
    const staged = path.join(extracted, expected.archiveName);
    if ((await sha256(staged)) !== expected.sha256) throw new Error(`VC DLL SHA-256 mismatch: ${name}`);
    await assertX64Pe(staged);
    await assertMicrosoftSignature(staged);
    for (const backend of ["cpu", "cuda"]) await copyFile(staged, path.join(whisper, backend, "Release", name));
  }

  const licenseDocx = path.join(temp, "license.docx");
  const licenseResponse = await fetch(REDIST.license, { signal: AbortSignal.timeout(120_000) });
  if (!licenseResponse.ok) throw new Error(`VC license download failed: ${licenseResponse.status}`);
  await writeFile(licenseDocx, Buffer.from(await licenseResponse.arrayBuffer()));
  const { stdout } = await exec(sevenZip, ["e", licenseDocx, "word/document.xml", "-so"], { windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  const terms = documentText(stdout);
  if (terms.length < 1_000) throw new Error("VC license document did not contain readable terms");
  await writeFile(licensePath, `Microsoft Visual C++ V14 Redistributable and Runtime License Terms\nSource: ${REDIST.license}\nRedistributable: ${REDIST.origin}\nVersion: ${REDIST.version}\n\n${terms}\n`, "utf8");

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.vcRuntime = { ...REDIST, files: Object.entries(dlls).map(([name, file]) => ({ name, sha256: file.sha256 })) };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
} finally {
  await rm(assertTempRoot(temp), { recursive: true, force: true });
}

console.log("Microsoft VC runtime staged beside CPU and CUDA Whisper binaries; no redistributable installer was executed.");
