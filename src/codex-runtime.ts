import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { lstat, open } from "node:fs/promises";
import path from "node:path";

export type CodexRuntimeSource = "bundled" | "installed" | "missing";

export interface CodexRuntime {
  executable: string | null;
  version: string | null;
  source: CodexRuntimeSource;
  error?: string;
}

interface Candidate {
  executable: string;
  source: Exclude<CodexRuntimeSource, "missing">;
}

export interface CodexExecutableInspectionOptions {
  /** Test seam. Production reads only the PE header, never an executable's contents. */
  readHeader?(executable: string): Promise<Buffer>;
  /** Test seam. Production starts `<executable> --version` with shell disabled. */
  runVersion?(executable: string): Promise<string>;
  source?: Exclude<CodexRuntimeSource, "missing">;
}

export interface CodexRuntimeDiscoveryOptions {
  /** Test seam for deterministic discovery order. */
  candidates?: readonly Candidate[];
  /** Test seam for filesystem/process probing. */
  inspect?(executable: string, source: Exclude<CodexRuntimeSource, "missing">): Promise<CodexRuntime>;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

const VENDOR_EXECUTABLE = ["vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe"];
const MAX_VERSION_OUTPUT_BYTES = 8 * 1024;
const VERSION_TIMEOUT_MS = 5_000;

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function absoluteDirectory(value: string | undefined, cwd: string): string | null {
  if (!value || !path.isAbsolute(value)) return null;
  const resolved = path.resolve(value);
  // PATH must never turn a repository-local executable into a discovered runtime.
  if (inside(cwd, resolved)) return null;
  return resolved;
}

function uniqueCandidates(candidates: readonly Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const key = path.normalize(candidate.executable).toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function npmCandidates(prefix: string): Candidate[] {
  const packageRoot = path.join(prefix, "node_modules", "@openai", "codex");
  return [
    { executable: path.join(prefix, "codex.exe"), source: "installed" },
    { executable: path.join(packageRoot, ...VENDOR_EXECUTABLE), source: "installed" },
    { executable: path.join(packageRoot, "node_modules", "@openai", "codex-win32-x64", ...VENDOR_EXECUTABLE), source: "installed" }
  ];
}

function nativeCandidate(directory: string): Candidate {
  return { executable: path.join(directory, "codex.exe"), source: "installed" };
}

/**
 * Returns only explicit known locations. It never searches the current directory,
 * recursively scans a drive, or runs npm/a shell to find Codex.
 */
export function knownCodexCandidates(bundledRoot: string, env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Candidate[] {
  const candidates: Candidate[] = [];
  const normalizedCwd = path.resolve(cwd);
  if (path.isAbsolute(bundledRoot)) candidates.push({ executable: path.join(path.resolve(bundledRoot), "package", ...VENDOR_EXECUTABLE), source: "bundled" });

  const prefixes = [
    absoluteDirectory(env.APPDATA && path.join(env.APPDATA, "npm"), normalizedCwd),
    absoluteDirectory(env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "npm"), normalizedCwd),
    absoluteDirectory(env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "pnpm"), normalizedCwd),
    absoluteDirectory(env.npm_config_prefix, normalizedCwd),
    absoluteDirectory(env.ProgramFiles && path.join(env.ProgramFiles, "nodejs"), normalizedCwd),
    absoluteDirectory(env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "nodejs"), normalizedCwd),
    absoluteDirectory(env.USERPROFILE && path.join(env.USERPROFILE, ".local", "bin"), normalizedCwd),
    absoluteDirectory(env.USERPROFILE && path.join(env.USERPROFILE, "scoop", "shims"), normalizedCwd)
  ].filter((value): value is string => !!value);

  for (const prefix of prefixes) candidates.push(nativeCandidate(prefix), ...npmCandidates(prefix));

  // User PATH is itself an explicit OS user configuration. We inspect only its
  // exact absolute entries, never the current project or any recursive search.
  // The PE check below still rejects .cmd/.ps1 shims and non-native files.
  for (const item of (env.PATH ?? "").split(path.delimiter)) {
    const directory = absoluteDirectory(item, normalizedCwd);
    if (!directory) continue;
    candidates.push(nativeCandidate(directory), ...npmCandidates(directory));
  }
  return uniqueCandidates(candidates);
}

async function readPeHeader(executable: string): Promise<Buffer> {
  const handle = await open(executable, "r");
  try {
    const header = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return header.subarray(0, bytesRead);
  } finally { await handle.close(); }
}

function isX64Pe(header: Buffer): boolean {
  if (header.length < 0x40 || header[0] !== 0x4d || header[1] !== 0x5a) return false;
  const offset = header.readUInt32LE(0x3c);
  if (offset > header.length - 6) return false;
  return header.subarray(offset, offset + 4).equals(Buffer.from([0x50, 0x45, 0x00, 0x00])) && header.readUInt16LE(offset + 4) === 0x8664;
}

/** Environment for `--version`: credentials and Codex configuration are excluded. */
export function versionProbeEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["SystemRoot", "WINDIR", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "ProgramData", "COMSPEC"]) {
    if (source[key]) env[key] = source[key];
  }
  return env;
}

function runVersion(executable: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    let settled = false;
    let output = "";
    const complete = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(output);
    };
    const append = (chunk: Buffer | string) => {
      if (settled) return;
      output += String(chunk);
      if (Buffer.byteLength(output, "utf8") > MAX_VERSION_OUTPUT_BYTES) {
        child.kill(); complete(new Error("Codex вернул слишком большой ответ версии"));
      }
    };
    const timer = setTimeout(() => { child.kill(); complete(new Error("Превышено время проверки Codex")); }, VERSION_TIMEOUT_MS);
    try {
      child = nodeSpawn(executable, ["--version"], { shell: false, windowsHide: true, env: versionProbeEnvironment(), stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      clearTimeout(timer); reject(new Error("Не удалось запустить Codex")); return;
    }
    child.once("error", () => complete(new Error("Не удалось запустить Codex")));
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.once("close", code => complete(code === 0 ? undefined : new Error("Codex завершился с ошибкой")));
  });
}

function supportedVersion(output: string): string | null {
  // Accept only the current 0.x protocol family. Compatibility beyond the
  // app-server handshake is checked by CodexProvider before any meeting data is sent.
  const match = output.match(/(?:^|\s)(?:codex(?:[- ]cli)?\s*)?v?(0)\.(\d+)\.(\d+)(?=\s|$)/im);
  if (!match) return null;
  const minor = Number(match[2]);
  if (!Number.isSafeInteger(minor) || minor < 145) return null;
  return `0.${minor}.${Number(match[3])}`;
}

/**
 * Checks one user-selected executable without reading Codex settings or auth.
 * Relative paths and command wrappers are rejected so shell lookup never occurs.
 */
export async function inspectCodexExecutable(executable: string, options: CodexExecutableInspectionOptions = {}): Promise<CodexRuntime> {
  const source = options.source ?? "installed";
  if (!path.isAbsolute(executable) || path.extname(executable).toLowerCase() !== ".exe") return { executable: null, version: null, source: "missing", error: "Выберите файл codex.exe" };
  try {
    if (!options.readHeader) {
      const info = await lstat(executable);
      if (!info.isFile() || info.isSymbolicLink()) return { executable: null, version: null, source: "missing", error: "Нужен обычный файл codex.exe" };
    }
    const header = await (options.readHeader ?? readPeHeader)(executable);
    if (!isX64Pe(header)) return { executable: null, version: null, source: "missing", error: "Файл не является 64-битным codex.exe" };
    const version = supportedVersion(await (options.runVersion ?? runVersion)(executable));
    if (!version) return { executable: null, version: null, source: "missing", error: "Нужен Codex версии 0.145.0 или новее" };
    return { executable, version, source };
  } catch {
    return { executable: null, version: null, source: "missing", error: "Не удалось проверить Codex" };
  }
}

/** Finds a bundled runtime first, then native executables in known global npm locations. */
export async function discoverCodexRuntime(bundledRoot: string, options: CodexRuntimeDiscoveryOptions = {}): Promise<CodexRuntime> {
  const candidates = options.candidates ?? knownCodexCandidates(bundledRoot, options.env, options.cwd);
  const inspect = options.inspect ?? ((executable: string, source: Exclude<CodexRuntimeSource, "missing">) => inspectCodexExecutable(executable, { source }));
  let lastError: string | undefined;
  for (const candidate of candidates) {
    const found = await inspect(candidate.executable, candidate.source);
    if (found.executable && found.version) return found;
    lastError = found.error ?? lastError;
  }
  return { executable: null, version: null, source: "missing", ...(lastError ? { error: lastError } : {}) };
}
